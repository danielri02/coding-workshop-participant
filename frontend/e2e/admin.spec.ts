import { type Page, type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

const apiUrl = process.env.E2E_API_URL || 'http://localhost:8000'
const browserApiUrl =
  process.env.E2E_API_MODE === 'workshop' ? 'http://localhost:3011/api/facilities' : apiUrl
const browserPath = (url: URL) => url.pathname.replace(/^\/api\/facilities(?=\/)/, '')
const email = process.env.E2E_ADMIN_EMAIL || 'admin@acme.inc'
const password = process.env.E2E_ADMIN_PASSWORD || 'admin'
let headers: Record<string, string>
let refreshToken: string
let cleanup: string[]

test.beforeEach(async ({ request }) => {
  cleanup = []
  const response = await request.post(`${apiUrl}/auth/login`, { data: { email, password } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const tokens = await response.json()
  headers = { Authorization: `Bearer ${tokens.access_token}` }
  refreshToken = tokens.refresh_token
})

test.afterEach(async ({ request }) => {
  for (const path of cleanup) await request.delete(`${apiUrl}${path}`, { headers })
  await request.post(`${apiUrl}/auth/logout`, { data: { refresh_token: refreshToken } })
})

async function signIn(page: Page, userEmail = email, userPassword = password) {
  await page.getByRole('textbox', { name: 'Email address' }).fill(userEmail)
  await page.getByLabel('Password', { exact: false }).fill(userPassword)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function switchWorkspace(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function navigate(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name, exact: true })
    .click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function select(page: Page, name: string, option: string) {
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: new RegExp(`^${name}`) })
    .click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function expectSummary(
  page: Page,
  scope: 'personal' | 'assigned',
  counts: Record<string, number>,
) {
  const summary = page.getByRole('region', {
    name: scope === 'assigned' ? 'Assigned incident summary' : 'My incident summary',
    exact: true,
  })
  for (const [label, value] of Object.entries(counts))
    await expect(
      summary
        .getByRole('article', { name: label, exact: true })
        .getByText(String(value), { exact: true }),
    ).toBeVisible()
}

async function save(page: Page, path: string, method = 'POST') {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${browserApiUrl}${path}` && response.request().method() === method,
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBeTruthy()
  const row = await response.json()
  if (method === 'POST')
    cleanup.unshift(`${path.startsWith('/incidents/') ? '/notes' : path}/${row.id ?? row.user_id}`)
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
  ).toBeHidden()
  return row
}

async function remove(page: Page, resource: string, id: number) {
  await page.getByRole('button', { name: `Delete ${resource} ${id}`, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(
      (result) => result.request().method() === 'DELETE' && result.url().endsWith(`/${id}`),
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click(),
  ])
  expect(response.status()).toBe(204)
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: `Delete ${resource} ${id}`, exact: true }),
  ).toBeHidden()
}

test('desktop navigation collapses without losing accessible resource links', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/admin/incidents')
  await signIn(page)
  const collapse = page.getByRole('button', { name: 'Collapse navigation', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  const expanded = await page.getByRole('main').boundingBox()
  await collapse.click()
  const expand = page.getByRole('button', { name: 'Expand navigation', exact: true })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(async () => (await page.getByRole('main').boundingBox())?.width || 0)
    .toBeGreaterThan((expanded?.width || 0) + 150)
  await navigate(page, 'Users')
  await expect(expand).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('collapsed-desktop.png'), fullPage: true })
  await expand.click()
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
})

test('compact and mobile layouts scroll grid columns without widening the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 })
  await page.goto('/admin/users')
  await signIn(page)
  await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeVisible()
  const grid = page.getByRole('grid')
  await expect.poll(async () => Number(await grid.getAttribute('aria-rowcount'))).toBeGreaterThan(1)
  for (const width of [1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 640 })
    if (width < 900)
      await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1)
    const scrollbar = grid.locator('.MuiDataGrid-scrollbar--horizontal')
    await expect(scrollbar).toBeVisible()
    await expect
      .poll(() => scrollbar.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(0)
    const viewport = grid.locator('.MuiDataGrid-virtualScroller')
    await viewport.evaluate((element) => {
      element.scrollLeft = 0
    })
    await viewport.hover()
    await page.mouse.wheel(500, 0)
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await scrollbar.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await expect
      .poll(() =>
        grid.locator('.MuiDataGrid-virtualScroller').evaluate((element) => element.scrollLeft),
      )
      .toBeGreaterThan(0)
    const view = grid.getByRole('button', { name: /^View users / }).first()
    await view.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    if (width === 390)
      await page.screenshot({ path: test.info().outputPath('mobile-grid.png'), fullPage: true })
  }
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await navigate(page, 'Buildings')
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
})

test('admin CRUD across all seven business tables with persisted browser data', async ({
  page,
}) => {
  test.setTimeout(120000)
  const suffix = Date.now().toString()
  const buildingName = `Test office ${suffix}`
  await page.goto('/admin/buildings')
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Buildings', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New building', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Building name').fill(buildingName)
  const building = await save(page, '/buildings')
  await page.getByRole('button', { name: `View buildings ${building.id}`, exact: true }).click()
  await expect(page.getByRole('dialog').getByText(buildingName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: `Edit buildings ${building.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Building name').fill(`${buildingName} updated`)
  await save(page, `/buildings/${building.id}`, 'PATCH')

  await navigate(page, 'Floors')
  await page.getByRole('button', { name: 'New floor', exact: true }).click()
  await select(page, 'Building', `${buildingName} updated`)
  await page.getByRole('dialog').getByLabel('Floor label').fill('12')
  const floor = await save(page, '/floors')
  await page.getByRole('textbox', { name: 'Search floors' }).fill(suffix)
  await page.getByRole('button', { name: `Edit floors ${floor.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Floor label').fill('13')
  await save(page, `/floors/${floor.id}`, 'PATCH')

  await navigate(page, 'Seats')
  await page.getByRole('button', { name: 'New seat', exact: true }).click()
  await select(page, 'Floor', `${buildingName} updated · Floor 13`)
  await page.getByRole('dialog').getByLabel('Seat label').fill('A1')
  const seat = await save(page, '/seats')
  await page.getByRole('textbox', { name: 'Search seats' }).fill(suffix)
  await page.getByRole('button', { name: `Edit seats ${seat.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Seat label').fill('A2')
  await save(page, `/seats/${seat.id}`, 'PATCH')

  await navigate(page, 'Users')
  await page.getByRole('button', { name: 'New user', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Name', { exact: false })
    .fill(`Test engineer ${suffix}`)
  await page
    .getByRole('dialog')
    .getByLabel('Email', { exact: false })
    .fill(`test.${suffix}@acme.inc`)
  await page.getByRole('dialog').getByLabel('Initial password').fill('test-password-12345')
  const user = await save(page, '/users')
  await page.getByRole('textbox', { name: 'Search users', exact: true }).fill(suffix)
  for (const label of ['Grant admin access', 'Remove admin access']) {
    await page.getByRole('button', { name: `More actions for users ${user.id}` }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    const updated = page.waitForResponse(
      (response) =>
        response.url() === `${browserApiUrl}/users/${user.id}/admin` &&
        response.request().method() === 'PATCH',
    )
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    expect((await updated).status()).toBe(200)
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await page.getByRole('button', { name: `Edit users ${user.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: false }).fill(`Engineer ${suffix}`)
  await save(page, `/users/${user.id}`, 'PATCH')

  await navigate(page, 'Engineers')
  await page.getByRole('button', { name: 'New engineer', exact: true }).click()
  await select(page, 'Employee', `Engineer ${suffix} · test.${suffix}@acme.inc`)
  await save(page, '/engineer-profiles')
  await page.getByRole('textbox', { name: 'Search engineers', exact: true }).fill(suffix)
  await page.getByRole('button', { name: `Edit engineers ${user.id}`, exact: true }).click()
  await page.getByRole('switch', { name: 'Available for assignment' }).uncheck()
  await save(page, `/engineer-profiles/${user.id}`, 'PATCH')

  await navigate(page, 'Incidents')
  await page.getByRole('button', { name: 'New incident', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: false }).fill(`Printer ${suffix}`)
  await page.getByRole('dialog').getByLabel('Description').fill('Printer needs repair.')
  await select(page, 'Category', 'Equipment')
  await select(page, 'Building', `${buildingName} updated`)
  await select(page, 'Floor', 'Floor 13')
  await select(page, 'Seat', 'A2')
  const incident = await save(page, '/incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await expect(
    page.getByRole('button', { name: `Edit incidents ${incident.id}`, exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: `Edit incidents ${incident.id}`, exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Title', { exact: false })
    .fill(`Printer ${suffix} updated`)
  await save(page, `/incidents/${incident.id}`, 'PATCH')
  await page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await page.getByRole('menuitem', { name: 'Assign engineer', exact: true }).click()
  await select(page, 'Assigned engineer', `Engineer ${suffix}`)
  await save(page, `/incidents/${incident.id}/assignment`, 'PATCH')
  await page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await page.getByRole('menuitem', { name: 'Change status', exact: true }).click()
  await select(page, 'Next status', 'Open')
  await save(page, `/incidents/${incident.id}/status`, 'PATCH')
  await page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await page.getByRole('menuitem', { name: 'View notes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Notes for incident #${incident.id}`)
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Note', { exact: false })
    .fill('Engineer has started work.')
  const note = await save(page, `/incidents/${incident.id}/notes`)
  await page.getByRole('button', { name: `Edit notes ${note.id}`, exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Note', { exact: false })
    .fill('Engineer is working on the printer.')
  await save(page, `/notes/${note.id}`, 'PATCH')
  await page.reload()
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await page.getByRole('menuitem', { name: 'View notes', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('gridcell', {
      name: 'Engineer is working on the printer.',
      exact: true,
    }),
  ).toBeVisible()
  await remove(page, 'notes', note.id)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await navigate(page, 'Incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await remove(page, 'incidents', incident.id)
  await navigate(page, 'Engineers')
  await page.getByRole('textbox', { name: 'Search engineers', exact: true }).fill(suffix)
  await remove(page, 'engineers', user.id)
  await navigate(page, 'Users')
  await page.getByRole('textbox', { name: 'Search users', exact: true }).fill(suffix)
  await remove(page, 'users', user.id)
  await navigate(page, 'Seats')
  await page.getByRole('textbox', { name: 'Search seats' }).fill(suffix)
  await remove(page, 'seats', seat.id)
  await navigate(page, 'Floors')
  await page.getByRole('textbox', { name: 'Search floors' }).fill(suffix)
  await remove(page, 'floors', floor.id)
  await navigate(page, 'Buildings')
  await remove(page, 'buildings', building.id)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

test('session refresh restores an expired access token and mobile navigation works', async ({
  page,
}) => {
  await page.goto('/admin/incidents')
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem('acme.admin.session') || 'null')
    session.access_token = 'expired-access-token'
    sessionStorage.setItem('acme.admin.session', JSON.stringify(session))
  })
  const refreshed = page.waitForResponse(
    (response) => response.url() === `${browserApiUrl}/auth/refresh`,
  )
  await page.reload()
  expect((await refreshed).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await navigate(page, 'Buildings')
  await expect(page.getByRole('button', { name: 'New building', exact: true })).toBeVisible()
})

test('employee credentials open their workspace and exclude admin navigation', async ({
  request,
  page,
}) => {
  const employeeEmail = `test.employee.${Date.now()}@acme.inc`
  const employeePassword = 'employee-password-12345'
  const response = await request.post(`${apiUrl}/users`, {
    data: { name: 'Employee', email: employeeEmail, password: employeePassword },
  })
  const user = await response.json()
  cleanup.unshift(`/users/${user.id}`)
  await page.goto('/admin/incidents')
  await signIn(page, employeeEmail, employeePassword)
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/employee\/incidents$/)
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
})

test('new employees register on mobile, sign in and add follow-up notes after resolution', async ({
  request,
  page,
}) => {
  test.setTimeout(90000)
  const suffix = `registration${Date.now()}`
  const newEmail = `${suffix}@acme.inc`
  const newPassword = '  registration-password-12345  '
  const posts: string[] = []
  page.on('request', (request) => {
    if (browserPath(new URL(request.url())) === '/users' && request.method() === 'POST')
      posts.push(request.postData() || '')
  })
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/employee/incidents')
  await page.getByRole('button', { name: 'Create an account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create your account' })
  const create = dialog.getByRole('button', { name: 'Create account', exact: true })
  await dialog.getByLabel('Name', { exact: false }).fill(`Employee ${suffix}`)
  await dialog.getByLabel('Email', { exact: false }).fill(`${suffix}@example.com`)
  await dialog.getByLabel('Password', { exact: false }).fill('short')
  await dialog.getByLabel('Name', { exact: false }).focus()
  await expect(create).toBeDisabled()
  await expect(
    dialog.getByText('Use a valid @acme.inc email address.', { exact: true }),
  ).toBeVisible()
  await expect(dialog.getByText('Use at least 12 characters.', { exact: true })).toBeVisible()
  expect(posts).toEqual([])
  await dialog.getByLabel('Email', { exact: false }).fill('employee@acme.inc')
  await dialog.getByLabel('Password', { exact: false }).fill(newPassword)
  const duplicate = page.waitForResponse(
    (response) =>
      browserPath(new URL(response.url())) === '/users' && response.request().method() === 'POST',
  )
  await create.click()
  expect((await duplicate).status()).toBe(409)
  await expect(dialog.getByRole('alert')).toContainText('Sign in instead')
  await expect(dialog.getByText('This email is already registered.', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Name', { exact: false })).toHaveValue(`Employee ${suffix}`)
  await dialog.getByLabel('Email', { exact: false }).fill(newEmail.toUpperCase())
  const registered = page.waitForResponse(
    (response) =>
      browserPath(new URL(response.url())) === '/users' && response.request().method() === 'POST',
  )
  await create.click()
  const result = await registered
  expect(result.status()).toBe(201)
  const account = await result.json()
  cleanup.unshift(`/users/${account.id}`)
  expect(account.email).toBe(newEmail)
  expect(account.is_admin).toBe(false)
  expect(account.engineer_profile).toBeNull()
  expect(JSON.parse(posts.at(-1)!)).toEqual({
    name: `Employee ${suffix}`,
    email: newEmail.toUpperCase(),
    password: newPassword,
  })
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('Your account has been created')
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue(newEmail)
  await expect(page.getByLabel('Password', { exact: false })).toHaveValue('')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await signIn(page, newEmail, newPassword)
  await expectSummary(page, 'personal', { Active: 0, Resolved: 0, Closed: 0 })
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  await page.getByRole('button', { name: 'New incident', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: false }).fill(suffix)
  await page
    .getByRole('dialog')
    .getByLabel('Description', { exact: false })
    .fill('A newly registered employee can report workplace issues.')
  await select(page, 'Category', 'Other')
  await select(page, 'Building', building.name)
  const incident = await save(page, '/incidents')
  expect(incident.reporter_id).toBe(account.id)
  expect(incident.priority).toBe('Low')
  const resolved = await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
    headers,
    data: { status: 'Resolved' },
  })
  expect(resolved.status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Note', { exact: false })
    .fill('Thanks, this is working after resolution.')
  const note = await save(page, `/incidents/${incident.id}/notes`)
  expect(note.author_id).toBe(account.id)
  await page.reload()
  await page.getByRole('link', { name: `#${incident.id} · ${suffix}`, exact: true }).click()
  await expect(
    page.getByText('Thanks, this is working after resolution.', { exact: true }),
  ).toBeVisible()
  const closed = await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
    headers,
    data: { status: 'Closed' },
  })
  expect(closed.status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeHidden()
  await expect(
    page.getByText('Thanks, this is working after resolution.', { exact: true }),
  ).toBeVisible()
})

for (const endpoint of ['/auth/login', '/auth/me']) {
  test(`unexpected JSON from ${endpoint} reports API configuration rather than admin denial`, async ({
    page,
  }) => {
    await page.route(`${browserApiUrl}${endpoint}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Development CORS Proxy Server' }),
      }),
    )
    await page.goto('/admin/incidents')
    await signIn(page)
    await expect(page.getByRole('alert')).toContainText(`unexpected response for ${endpoint}`)
    await expect(page.getByRole('alert')).toContainText('VITE_API_URL')
    await expect(page.getByRole('alert')).not.toContainText('requires Facility Admin access')
    expect(await page.evaluate(() => sessionStorage.getItem('acme.admin.session'))).toBeNull()
  })
}

test('incident actions validate blocked reasons and preserve note editing after closure', async ({
  request,
  page,
}) => {
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const response = await request.post(`${apiUrl}/incidents`, {
    headers,
    data: {
      title: `Workflow test ${Date.now()}`,
      description: 'Verify admin incident actions.',
      category: 'Electrical',
      building_id: building.id,
    },
  })
  const incident = await response.json()
  cleanup.unshift(`/incidents/${incident.id}`)
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(incident.title)
  const more = () =>
    page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await more()
  await page.getByRole('menuitem', { name: 'Priority and escalation' }).click()
  await select(page, 'Priority', 'High')
  await page.getByRole('dialog').getByLabel('Escalation reason').fill('Service disruption')
  await save(page, `/incidents/${incident.id}/priority`, 'PATCH')
  await more()
  await page.getByRole('menuitem', { name: 'Change status' }).click()
  await select(page, 'Next status', 'In Progress')
  await save(page, `/incidents/${incident.id}/status`, 'PATCH')
  await more()
  await page.getByRole('menuitem', { name: 'Change status' }).click()
  await select(page, 'Next status', 'Blocked')
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.getByRole('dialog').getByLabel('Blocked reason').fill('Waiting for a part')
  await save(page, `/incidents/${incident.id}/status`, 'PATCH')
  await more()
  await page.getByRole('menuitem', { name: 'View notes', exact: true }).click()
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Note', { exact: false }).fill('Part ordered')
  const note = await save(page, `/incidents/${incident.id}/notes`)
  for (const status of ['In Progress', 'Resolved', 'Closed']) {
    expect(
      (
        await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
          headers,
          data: { status },
        })
      ).ok(),
    ).toBeTruthy()
    if (status === 'Resolved') {
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.getByRole('button', { name: 'New note', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByLabel('Note', { exact: false })
        .fill('Admin follow-up after resolution')
      await save(page, `/incidents/${incident.id}/notes`)
    }
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert').filter({ hasText: 'This incident is closed' })).toBeVisible()
  await page.getByRole('button', { name: `Edit notes ${note.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Note', { exact: false }).fill('Resolved and verified')
  await save(page, `/notes/${note.id}`, 'PATCH')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await navigate(page, 'Floors')
  const floors = await (await request.get(`${apiUrl}/floors`, { headers })).json()
  const duplicate = floors.find(
    (floor: { building_id: number }) => floor.building_id === building.id,
  )
  await page.getByRole('button', { name: 'New floor', exact: true }).click()
  await select(page, 'Building', building.name)
  await page.getByRole('dialog').getByLabel('Floor label').fill(duplicate.label)
  const conflict = page.waitForResponse(
    (result) => result.url() === `${browserApiUrl}/floors` && result.request().method() === 'POST',
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  expect((await conflict).status()).toBe(409)
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already exists')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('incident grid defaults to newest first and filters assignment with server paging', async ({
  request,
  page,
}) => {
  const suffix = `gridcheck${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const engineer = (await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json())[0]
  for (let index = 0; index < 12; index += 1) {
    const response = await request.post(`${apiUrl}/incidents`, {
      headers,
      data: {
        title: `${suffix} ${index.toString().padStart(2, '0')}`,
        description: 'Grid pagination test.',
        category: 'Other',
        building_id: building.id,
      },
    })
    expect(response.ok()).toBeTruthy()
    const incident = await response.json()
    cleanup.unshift(`/incidents/${incident.id}`)
    if (index % 2) {
      const assigned = await request.patch(`${apiUrl}/incidents/${incident.id}/assignment`, {
        headers,
        data: { assignee_id: engineer.user_id },
      })
      expect(assigned.ok(), await assigned.text()).toBeTruthy()
    }
  }
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /^Reported/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
  await expect(page.getByRole('grid').getByRole('row').nth(1)).toContainText(`${suffix} 11`)
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(page.getByText('11–12 of 12', { exact: true })).toBeVisible()
  for (const [option, unassigned] of [
    ['Unassigned', true],
    ['Assigned', false],
  ] as const) {
    const filtered = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        browserPath(url) === '/incidents/grid' &&
        url.searchParams.get('unassigned') === String(unassigned) &&
        url.searchParams.get('page') === '0'
      )
    })
    await page.getByRole('combobox', { name: 'Assignment', exact: true }).click()
    await page.getByRole('option', { name: option, exact: true }).click()
    const response = await filtered
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.row_count).toBe(6)
    expect(
      data.rows.every((row: { assignee_id: number | null }) =>
        unassigned ? row.assignee_id === null : row.assignee_id === engineer.user_id,
      ),
    ).toBeTruthy()
    await expect(page.getByText('1–6 of 6', { exact: true })).toBeVisible()
  }
  await page.getByRole('combobox', { name: 'Assignment', exact: true }).click()
  await page.getByRole('option', { name: 'All incidents', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  const sorted = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('sort_by') === 'title' &&
      url.searchParams.get('page') === '0'
    )
  })
  await page.getByRole('columnheader', { name: /^Incident/ }).click()
  expect((await sorted).status()).toBe(200)
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show filters' }).click()
  await page
    .getByRole('dialog', { name: 'Show filters' })
    .getByRole('combobox', { name: 'Value', exact: true })
    .click()
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('status') === 'Closed' &&
      url.searchParams.get('search') === suffix
    )
  })
  await page.getByRole('option', { name: 'Closed', exact: true }).click()
  expect((await filtered).status()).toBe(200)
  await page.keyboard.press('Escape')
  await expect(page.getByText('No records to show', { exact: true })).toBeVisible()
})

test('admin incident quick views reset stale filters and expose workflow reasons', async ({
  request,
  page,
}) => {
  test.setTimeout(90000)
  const suffix = `quickview${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  for (const status of ['Open', 'Assigned', 'Blocked', 'Resolved']) {
    const result = await request.post(`${apiUrl}/incidents`, {
      headers,
      data: {
        title: `${suffix} ${status}`,
        description: 'Quick view verification',
        category: 'Other',
        building_id: building.id,
        ...(status === 'Open' ? { escalation_reason: 'Escalation quick view fixture' } : {}),
      },
    })
    expect(result.ok()).toBeTruthy()
    const incident = await result.json()
    cleanup.unshift(`/incidents/${incident.id}`)
    if (status !== 'Open') {
      const updated = await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
        headers,
        data: {
          status,
          ...(status === 'Blocked' ? { blocked_reason: 'Blocked quick view fixture' } : {}),
        },
      })
      expect(updated.ok(), await updated.text()).toBeTruthy()
    }
  }
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('combobox', { name: 'Rows per page:', exact: true }).click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await page
    .getByRole('textbox', { name: 'Search incidents', exact: true })
    .fill('this search should be cleared')
  for (const [view, field, value, reason] of [
    ['Blocked', 'status', 'Blocked', 'Blocked reason'],
    ['Escalated', 'escalated', 'true', 'Escalation reason'],
    ['Ready to close', 'status', 'Resolved', ''],
    ['Awaiting acceptance', 'status', 'Assigned', ''],
    ['Needs assignment', 'unassigned', 'true', ''],
  ]) {
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        browserPath(url) === '/incidents/grid' &&
        url.searchParams.get('page') === '0' &&
        !url.searchParams.has('search') &&
        (field
          ? url.searchParams.get(field) === value
          : !url.searchParams.has('status') &&
            !url.searchParams.has('escalated') &&
            !url.searchParams.has('unassigned'))
      )
    })
    await page.getByRole('combobox', { name: 'Quick view', exact: true }).click()
    await page.getByRole('option', { name: view, exact: true }).click()
    const response = await loaded
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.rows.length).toBeGreaterThan(0)
    expect(data.page).toBe(0)
    await expect(page.getByRole('textbox', { name: 'Search incidents', exact: true })).toHaveValue(
      '',
    )
    await expect(page.getByRole('combobox', { name: 'Quick view', exact: true })).toHaveText(view)
    if (reason) {
      await expect(page.getByRole('columnheader', { name: reason, exact: true })).toBeVisible()
      await expect(
        page.getByRole('gridcell', {
          name: `${reason === 'Blocked reason' ? 'Blocked' : 'Escalation'} quick view fixture`,
          exact: true,
        }),
      ).toBeVisible()
    } else {
      await expect(
        page.getByRole('columnheader', { name: 'Blocked reason', exact: true }),
      ).toBeHidden()
      await expect(
        page.getByRole('columnheader', { name: 'Escalation reason', exact: true }),
      ).toBeHidden()
    }
  }
  await page.getByRole('combobox', { name: 'Quick view', exact: true }).click()
  await page.getByRole('option', { name: 'All incidents', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Quick view', exact: true })).toHaveText(
    'All incidents',
  )
  await expect(page.getByRole('link', { name: `${suffix} Resolved`, exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Blocked reason', exact: true })).toBeHidden()
  await expect(
    page.getByRole('columnheader', { name: 'Escalation reason', exact: true }),
  ).toBeHidden()
  await page.getByRole('textbox', { name: 'Search incidents', exact: true }).fill(suffix)
  await expect(page.getByRole('combobox', { name: 'Quick view', exact: true })).toHaveText('Custom')
  await page.setViewportSize({ width: 320, height: 640 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
})

test('reports provide aggregate grids and backend timing search, paging and sorting', async ({
  request,
  page,
}) => {
  test.setTimeout(120000)
  const suffix = `reportcheck${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const floors = await (await request.get(`${apiUrl}/floors`, { headers })).json()
  const floor = floors.find((row: { building_id: number }) => row.building_id === building.id)
  const seats = await (await request.get(`${apiUrl}/seats`, { headers })).json()
  const seat = seats.find((row: { floor_id: number }) => row.floor_id === floor?.id)
  const ids: number[] = []
  for (let index = 0; index < 12; index++) {
    const result = await request.post(`${apiUrl}/incidents`, {
      headers,
      data: {
        title: `${suffix} ${String(index).padStart(2, '0')}`,
        description: 'Report browser verification.',
        category: 'Other',
        building_id: building.id,
        floor_id: floor?.id,
        seat_id: seat?.id,
      },
    })
    expect(result.ok(), await result.text()).toBeTruthy()
    const incident = await result.json()
    ids.push(incident.id)
    cleanup.unshift(`/incidents/${incident.id}`)
  }
  const engineer = (await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json())[0]
  expect(
    (
      await request.patch(`${apiUrl}/incidents/${ids[0]}/assignment`, {
        headers,
        data: { assignee_id: engineer.user_id },
      })
    ).ok(),
  ).toBeTruthy()
  for (const status of ['In Progress', 'Resolved']) {
    expect(
      (
        await request.patch(`${apiUrl}/incidents/${ids[0]}/status`, { headers, data: { status } })
      ).ok(),
    ).toBeTruthy()
  }
  await page.setViewportSize({ width: 1024, height: 540 })
  await page.goto('/admin/incidents')
  await signIn(page)
  const navigation = page.getByRole('navigation', { name: 'Administration' })
  await navigation.getByRole('button', { name: 'Reports', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Collapse navigation', exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'Reports', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(navigation.getByRole('link')).toHaveCount(11)
  await navigate(page, 'Recurring locations')
  await page.getByRole('combobox', { name: 'Group by location' }).click()
  await page.getByRole('option', { name: 'Seat', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'Seat', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: seat.label, exact: true }).first()).toBeVisible()
  const reportOrigin = page.url()
  await page
    .getByRole('grid')
    .locator(`[role="row"][data-id="seat:${seat.id}"]`)
    .getByRole('link', { name: seat.label, exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Seat #${seat.id}`)
  expect(page.url()).toBe(reportOrigin)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Other', exact: true }).click()
  await expect(page).toHaveURL(/category=Other/)
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveText(
    'Last 7 days',
  )
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveText('Other')
  await expect(page.getByRole('columnheader', { name: 'Category', exact: true })).toBeHidden()
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('button', { name: 'Reports', exact: true })
    .click()
  await navigate(page, 'Category frequency')
  await page.getByRole('combobox', { name: 'Building', exact: true }).click()
  await page.getByRole('option', { name: building.name, exact: true }).click()
  await page.getByRole('combobox', { name: 'Floor', exact: true }).click()
  await page.getByRole('option', { name: floor.label, exact: true }).click()
  await page.getByRole('combobox', { name: 'Seat', exact: true }).click()
  await page.getByRole('option', { name: seat.label, exact: true }).click()
  const categories = await (
    await request.get(
      `${apiUrl}/reports/categories?building_id=${building.id}&floor_id=${floor.id}&seat_id=${seat.id}`,
      { headers },
    )
  ).json()
  const other = categories.rows.find((row: { category: string }) => row.category === 'Other')
  const categoryRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: 'Other', exact: true }) })
  await expect(categoryRow.locator('[data-field="incident_count"]')).toHaveText(
    String(other.incident_count),
  )
  await page.getByRole('combobox', { name: 'Building', exact: true }).click()
  await page.getByRole('option', { name: 'All locations', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Floor', exact: true })).toBeHidden()
  expect(new URL(page.url()).searchParams.has('seat_id')).toBe(false)
  await navigate(page, 'Engineer workload')
  await expect(page.getByRole('columnheader', { name: 'Active', exact: true })).toBeVisible()
  await expect(page.getByText('Unassigned active incidents', { exact: true })).toBeVisible()
  await navigate(page, 'Response times')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await page.getByRole('combobox', { name: 'Rows per page:', exact: true }).click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await expect(page.getByText('1 recorded of 12 matching incidents', { exact: true })).toHaveCount(
    3,
  )
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(page.getByText('11–12 of 12', { exact: true })).toBeVisible()
  const sorted = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/reports/timings' &&
      url.searchParams.get('sort_by') === 'title' &&
      url.searchParams.get('page') === '0'
    )
  })
  await page.getByRole('columnheader', { name: /^Incident/ }).click()
  expect((await sorted).status()).toBe(200)
  await page.getByRole('link', { name: `${suffix} 00`, exact: true }).click()
  await expect(page.getByRole('dialog').getByText(`${suffix} 00`, { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Incident scope' })).toBeHidden()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Other', exact: true }).click()
  const engineerUser = await (
    await request.get(`${apiUrl}/users/${engineer.user_id}`, { headers })
  ).json()
  await page.getByRole('combobox', { name: 'Current engineer', exact: true }).click()
  await page.getByRole('option', { name: engineerUser.name, exact: true }).click()
  await expect(page.getByText('1–1 of 1', { exact: true })).toBeVisible()
  await expect(page.getByText('1 recorded of 1 matching incidents', { exact: true })).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'All time', exact: true }).click()
  const legacy = new URL(page.url())
  legacy.searchParams.set('scope', 'personal')
  await page.goto(legacy.toString())
  await expect.poll(() => new URL(page.url()).searchParams.has('scope')).toBe(false)
  await expect(page.getByRole('combobox', { name: 'Current engineer', exact: true })).toHaveText(
    engineerUser.name,
  )
  await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveText('All time')
  await page.setViewportSize({ width: 320, height: 640 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: test.info().outputPath('response-times.png'), fullPage: true })
})

test('reports menu remains reachable and collapsible in a short mobile sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 })
  await page.goto('/admin/reports/workload')
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Engineer workload', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Administration' })
  await expect
    .poll(() => navigation.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0)
  const reportsButton = navigation.getByRole('button', { name: 'Reports', exact: true })
  await reportsButton.click()
  await expect(reportsButton).toHaveAttribute('aria-expanded', 'false')
  await reportsButton.click()
  await expect(reportsButton).toHaveAttribute('aria-expanded', 'true')
  await navigation
    .getByRole('link', { name: 'Category frequency', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: test.info().outputPath('scrollable-reports-menu.png'),
    fullPage: true,
  })
  await navigate(page, 'Category frequency')
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  const scrollbar = page.getByRole('grid').locator('.MuiDataGrid-scrollbar--horizontal')
  await expect(scrollbar).toBeVisible()
  await scrollbar.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})

test('one dialog follows records and related grids without changing the incident page', async ({
  request,
  page,
}) => {
  test.setTimeout(120000)
  const suffix = `incidentlinks${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const floor = (await (await request.get(`${apiUrl}/floors`, { headers })).json()).find(
    (item: { building_id: number }) => item.building_id === building.id,
  )
  const seat = (await (await request.get(`${apiUrl}/seats`, { headers })).json()).find(
    (item: { floor_id: number }) => item.floor_id === floor.id,
  )
  const engineer = (await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json())[0]
  const engineerUser = await (
    await request.get(`${apiUrl}/users/${engineer.user_id}`, { headers })
  ).json()
  const response = await request.post(`${apiUrl}/incidents`, {
    headers,
    data: {
      title: suffix,
      description: 'Verify record and relationship dialogs.',
      category: 'Equipment',
      building_id: building.id,
      floor_id: floor.id,
      seat_id: seat.id,
    },
  })
  expect(response.ok()).toBeTruthy()
  const incident = await response.json()
  cleanup.unshift(`/incidents/${incident.id}`)
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  const origin = page.url()
  const dialog = page.getByRole('dialog')
  const one = async (title: string) => {
    await expect(dialog).toHaveCount(1)
    await expect(page.locator('[role="dialog"]')).toHaveCount(1)
    await expect(dialog).toHaveAccessibleName(title)
    expect(page.url()).toBe(origin)
  }
  const back = () => dialog.getByRole('button', { name: 'Back', exact: true }).click()
  const row = page.getByRole('grid').locator(`[role="row"][data-id="${incident.id}"]`)
  await row.getByRole('gridcell', { name: 'Open', exact: true }).dblclick()
  await expect(dialog).toBeHidden()
  await row.getByRole('link', { name: suffix, exact: true }).focus()
  await page.keyboard.press('Enter')
  await one(`Incident #${incident.id}`)
  await dialog.getByRole('button', { name: 'Assign engineer', exact: true }).click()
  await expect(dialog).toHaveCount(1)
  await select(page, 'Assigned engineer', engineerUser.name)
  const assignment = await save(page, `/incidents/${incident.id}/assignment`, 'PATCH')
  expect(assignment.status).toBe('Assigned')
  await one(`Incident #${incident.id}`)
  await dialog.getByRole('button', { name: 'Priority and escalation', exact: true }).click()
  await select(page, 'Priority', 'High')
  await save(page, `/incidents/${incident.id}/priority`, 'PATCH')
  await one(`Incident #${incident.id}`)
  await dialog.getByRole('link', { name: engineerUser.name, exact: true }).click()
  await one(`Engineer #${engineer.user_id}`)
  await expect(dialog.getByText(engineerUser.email, { exact: true })).toBeVisible()
  await dialog.getByRole('link', { name: 'Assigned incidents', exact: true }).click()
  await expect(dialog).toHaveAccessibleName(/Incidents assigned to/)
  await dialog.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await dialog.getByRole('link', { name: suffix, exact: true }).click()
  await one(`Incident #${incident.id}`)
  await back()
  await expect(dialog.getByRole('textbox', { name: 'Search incidents' })).toHaveValue(suffix)
  await back()
  await one(`Engineer #${engineer.user_id}`)
  await back()
  await one(`Incident #${incident.id}`)
  await dialog.getByRole('link', { name: building.name, exact: true }).click()
  await one(`Building #${building.id}`)
  await dialog.getByRole('link', { name: 'View floors', exact: true }).click()
  await expect(dialog).toHaveAccessibleName(`Floors in ${building.name}`)
  await dialog.getByRole('link', { name: floor.label, exact: true }).click()
  await one(`Floor #${floor.id}`)
  await dialog.getByRole('link', { name: 'View seats', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Search seats' }).fill(seat.label)
  await dialog.getByRole('link', { name: seat.label, exact: true }).click()
  await one(`Seat #${seat.id}`)
  await back()
  await expect(dialog.getByRole('textbox', { name: 'Search seats' })).toHaveValue(seat.label)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Search incidents' })).toHaveValue(suffix)
  await expect(row.getByRole('gridcell', { name: 'High', exact: true })).toBeVisible()
  const scroller = page.getByRole('grid').locator('.MuiDataGrid-virtualScroller')
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  const scroll = await scroller.evaluate((element) => element.scrollLeft)
  await row.getByRole('link', { name: 'View notes', exact: true }).click()
  await one(`Notes for incident #${incident.id}`)
  await dialog.getByRole('button', { name: 'New note', exact: true }).click()
  await dialog.getByLabel('Note', { exact: false }).fill('Navigation works for this incident.')
  const note = await save(page, `/incidents/${incident.id}/notes`)
  await one(`Notes for incident #${incident.id}`)
  await dialog
    .getByRole('link', { name: 'Navigation works for this incident.', exact: true })
    .click()
  await one(`Note #${note.id}`)
  await dialog.getByRole('link', { name: String(incident.id), exact: true }).click()
  await one(`Incident #${incident.id}`)
  await back()
  await one(`Note #${note.id}`)
  await back()
  await one(`Notes for incident #${incident.id}`)
  await page.setViewportSize({ width: 320, height: 640 })
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await dialog.screenshot({ path: test.info().outputPath('related-notes-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Search incidents' })).toHaveValue(suffix)
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(scroll)
})

test('employee dialog relationships keep account privacy and incident permissions', async ({
  request,
  page,
}) => {
  test.setTimeout(90000)
  const suffix = `memberdialogs${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const engineer = (await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json())[0]
  const engineerUser = await (
    await request.get(`${apiUrl}/users/${engineer.user_id}`, { headers })
  ).json()
  const employeeLogin = await request.post(`${apiUrl}/auth/login`, {
    data: { email: 'employee@acme.inc', password: 'employee' },
  })
  const tokens = await employeeLogin.json()
  const employeeHeaders = { Authorization: `Bearer ${tokens.access_token}` }
  const employee = await (
    await request.get(`${apiUrl}/auth/me`, { headers: employeeHeaders })
  ).json()
  const response = await request.post(`${apiUrl}/incidents`, {
    headers: employeeHeaders,
    data: {
      title: suffix,
      description: 'Employee relationship navigation',
      category: 'Other',
      building_id: building.id,
    },
  })
  const incident = await response.json()
  cleanup.unshift(`/incidents/${incident.id}`)
  await request.patch(`${apiUrl}/incidents/${incident.id}/assignment`, {
    headers,
    data: { assignee_id: engineer.user_id },
  })
  const adminNote = await (
    await request.post(`${apiUrl}/incidents/${incident.id}/notes`, {
      headers,
      data: { body: 'An admin has assigned this incident.' },
    })
  ).json()
  cleanup.unshift(`/notes/${adminNote.id}`)
  const privateResult = await request.post(`${apiUrl}/incidents`, {
    headers,
    data: {
      title: `${suffix} private`,
      description: 'Must remain hidden from the employee.',
      category: 'Other',
      building_id: building.id,
    },
  })
  const privateIncident = await privateResult.json()
  cleanup.unshift(`/incidents/${privateIncident.id}`)
  await request.post(`${apiUrl}/auth/logout`, { data: { refresh_token: tokens.refresh_token } })
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().startsWith(browserApiUrl))
      reads.push(browserPath(new URL(request.url())))
  })
  await page.goto('/employee/incidents')
  await signIn(page, 'employee@acme.inc', 'employee')
  await page.getByRole('textbox', { name: 'Search my incidents' }).fill(suffix)
  const origin = page.url()
  await page.getByRole('link', { name: `#${incident.id} · ${suffix}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await expect(dialog.getByRole('link', { name: adminNote.author_name, exact: true })).toBeHidden()
  await dialog.getByRole('link', { name: engineerUser.name, exact: true }).click()
  await expect(dialog).toHaveAccessibleName(`Engineer #${engineer.user_id}`)
  await expect(dialog.getByText(engineerUser.email, { exact: true })).toBeHidden()
  await expect(dialog.getByRole('link', { name: 'Assigned incidents', exact: true })).toBeHidden()
  await expect(dialog.getByRole('button', { name: 'Edit engineer', exact: true })).toBeHidden()
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByRole('link', { name: building.name, exact: true }).click()
  await dialog.getByRole('link', { name: 'View incidents', exact: true }).click()
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('building_id') === String(building.id) &&
      url.searchParams.get('search') === suffix
    )
  })
  await dialog.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  expect((await (await searched).json()).row_count).toBe(1)
  await expect(dialog.getByRole('link', { name: `${suffix} private`, exact: true })).toBeHidden()
  await dialog.getByRole('link', { name: suffix, exact: true }).click()
  await dialog.getByRole('link', { name: employee.name, exact: true }).click()
  await expect(dialog).toHaveAccessibleName(`User #${employee.id}`)
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(1)
  await dialog.getByLabel('Note', { exact: false }).fill('A follow-up through the record dialog.')
  await save(page, `/incidents/${incident.id}/notes`)
  await expect(
    dialog.getByText('A follow-up through the record dialog.', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(page.url()).toBe(origin)
  await expect(page.getByRole('textbox', { name: 'Search my incidents' })).toHaveValue(suffix)
  expect([...new Set(reads.filter((path) => /^\/users(\/|$)/.test(path)))]).toEqual([
    `/users/${employee.id}`,
  ])
  expect(reads).not.toContain('/engineer-profiles')
  expect(reads).not.toContain(`/incidents/${privateIncident.id}`)
})

test('demo employee submits incidents, tracks progress and shares notes on mobile', async ({
  request,
  page,
}) => {
  test.setTimeout(90000)
  const suffix = `employeecheck${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const floors = await (await request.get(`${apiUrl}/floors`, { headers })).json()
  const floor = floors.find((row: { building_id: number }) => row.building_id === building.id)
  const seats = await (await request.get(`${apiUrl}/seats`, { headers })).json()
  const seat = seats.find((row: { floor_id: number }) => row.floor_id === floor.id)
  const requested: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(browserApiUrl)) requested.push(new URL(request.url()).pathname)
  })
  await page.goto('/')
  await signIn(page, 'employee@acme.inc', 'employee')
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
  const employeeToken = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('acme.admin.session')!).access_token,
  )
  const owned = await (
    await request.get(`${apiUrl}/incidents`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    })
  ).json()
  const activeBefore = owned.filter((row: { status: string }) =>
    ['Open', 'Assigned', 'In Progress', 'Blocked'].includes(row.status),
  ).length
  const summary = page.getByRole('region', { name: 'My incident summary', exact: true })
  await expect(
    summary
      .getByRole('article', { name: 'Active', exact: true })
      .getByText(String(activeBefore), { exact: true }),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Rows per page:', exact: true }).click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText(`1–10 of ${owned.length}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(
    page.getByText(`11–${Math.min(20, owned.length)} of ${owned.length}`, { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'New incident', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.getByRole('dialog').getByLabel('Title', { exact: false }).fill(suffix)
  await page
    .getByRole('dialog')
    .getByLabel('Description')
    .fill('The network connection at my desk keeps dropping.')
  await select(page, 'Category', 'Network')
  await select(page, 'Building', building.name)
  await select(page, 'Floor', `Floor ${floor.label}`)
  await select(page, 'Seat', seat.label)
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Priority', exact: false }),
  ).toBeHidden()
  await expect(page.getByRole('dialog').getByLabel('Escalation reason')).toBeHidden()
  const incident = await save(page, '/incidents')
  expect(incident.priority).toBe('Low')
  await expect(page).toHaveURL(/\/employee\/incidents$/)
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Incident #${incident.id}`)
  await expect(page.getByRole('heading', { name: suffix, exact: true })).toBeVisible()
  await expect(
    page.getByRole('dialog').getByText('Awaiting assignment', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign engineer', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Change status', exact: true })).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Priority and escalation', exact: true }),
  ).toBeHidden()
  const escalated = await request.patch(`${apiUrl}/incidents/${incident.id}/priority`, {
    headers,
    data: { priority: 'High', escalation_reason: 'Unable to join meetings' },
  })
  expect(escalated.status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to join meetings' })).toBeVisible()
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Note', { exact: false })
    .fill('The connection also drops after restarting.')
  await save(page, `/incidents/${incident.id}/notes`)
  await expect(
    page.getByText('The connection also drops after restarting.', { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 640 })
  await page.screenshot({
    path: test.info().outputPath('employee-incident-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 320, height: 640 })
  await page.reload()
  await page.getByRole('textbox', { name: 'Search my incidents' }).fill(suffix)
  await page.getByRole('link', { name: `#${incident.id} · ${suffix}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: suffix, exact: true })).toBeVisible()
  await expect(
    page.getByText('The connection also drops after restarting.', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search my incidents' }).fill('')
  await page.getByRole('textbox', { name: 'Search my incidents' }).fill(suffix)
  await expect(
    summary
      .getByRole('article', { name: 'Active', exact: true })
      .getByText(String(activeBefore + 1), { exact: true }),
  ).toBeVisible()
  await expect(summary).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('employee-summary-mobile.png'),
    fullPage: true,
  })
  await expect(
    page.getByRole('link', { name: `#${incident.id} · ${suffix}`, exact: true }),
  ).toBeVisible()
  const scrollbar = page.getByRole('grid').locator('.MuiDataGrid-scrollbar--horizontal')
  await expect(scrollbar).toBeVisible()
  await scrollbar.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(requested.some((path) => /\/(users|engineer-profiles)(\/|$)/.test(path))).toBeFalsy()
  expect(
    requested
      .filter((path) => /\/reports(\/|$)/.test(path))
      .every((path) => path.endsWith('/reports/summary')),
  ).toBeTruthy()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible()
})

test('employee workspace and API exclude other reports and privileged operations', async ({
  request,
  page,
}) => {
  const requested: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(browserApiUrl)) requested.push(browserPath(new URL(request.url())))
  })
  await page.goto('/admin/users')
  await signIn(page, 'employee@acme.inc', 'employee')
  await expect(page).toHaveURL(/\/employee\/incidents$/)
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  const accessToken = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('acme.admin.session')!).access_token,
  )
  const employeeHeaders = { Authorization: `Bearer ${accessToken}` }
  const account = await (
    await request.get(`${apiUrl}/auth/me`, { headers: employeeHeaders })
  ).json()
  const own = await (await request.get(`${apiUrl}/incidents`, { headers: employeeHeaders })).json()
  expect(own.length).toBeGreaterThan(10)
  expect(own.every((row: { reporter_id: number }) => row.reporter_id === account.id)).toBeTruthy()
  const all = await (await request.get(`${apiUrl}/incidents`, { headers })).json()
  const other = all.find((row: { reporter_id: number }) => row.reporter_id !== account.id)
  const closed = own.find((row: { status: string }) => row.status === 'Closed')
  for (const path of [
    `/incidents/${other.id}`,
    `/incidents/${other.id}/notes`,
    '/users',
    '/reports/workload',
  ]) {
    expect((await request.get(`${apiUrl}${path}`, { headers: employeeHeaders })).status()).toBe(403)
  }
  for (const [path, data] of [
    [`/incidents/${own[0].id}/status`, { status: 'In Progress' }],
    [`/incidents/${own[0].id}/assignment`, { assignee_id: null }],
    [`/incidents/${own[0].id}`, { title: 'Not permitted' }],
    [`/incidents/${other.id}/priority`, { priority: 'High' }],
    [`/incidents/${own[0].id}/priority`, { priority: 'High', escalation_reason: 'Not permitted' }],
  ] as const)
    expect(
      (await request.patch(`${apiUrl}${path}`, { headers: employeeHeaders, data })).status(),
    ).toBe(403)
  expect(
    (
      await request.delete(`${apiUrl}/incidents/${own[0].id}`, { headers: employeeHeaders })
    ).status(),
  ).toBe(403)
  await page.goto('/engineer/incidents')
  await expect(page).toHaveURL(/\/employee\/incidents$/)
  await expect(page.getByRole('tab', { name: 'Assigned to me', exact: true })).toBeHidden()
  await page.goto(`/employee/incidents/${other.id}`)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: other.title, exact: true })).toBeHidden()
  expect(requested).not.toContain(`/incidents/${other.id}/notes`)
  await page.goto(`/employee/incidents/${closed.id}`)
  await expect(page.getByRole('heading', { name: closed.title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Priority and escalation', exact: true }),
  ).toBeHidden()
  await expect(
    page.getByText('Confirmed working again. Thank you for the update.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Assign engineer|Change status|Delete|Edit/ }),
  ).toBeHidden()
  await expect(page.getByRole('link', { name: /Users|Engineers|Reports/ })).toBeHidden()
  await page.screenshot({
    path: test.info().outputPath('employee-closed-incident.png'),
    fullPage: true,
  })
})

async function engineerFixture(request: APIRequestContext, count = 1) {
  const prefix = `engineercheck${Date.now()}`
  const engineerPassword = 'engineer-browser-password'
  const registered = await request.post(`${apiUrl}/users`, {
    data: { name: `Engineer ${prefix}`, email: `${prefix}@acme.inc`, password: engineerPassword },
  })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  const user = await registered.json()
  cleanup.unshift(`/users/${user.id}`)
  const profile = await request.post(`${apiUrl}/engineer-profiles`, {
    headers,
    data: { user_id: user.id },
  })
  expect(profile.ok(), await profile.text()).toBeTruthy()
  cleanup.unshift(`/engineer-profiles/${user.id}`)
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const assigned = []
  for (let index = 0; index < count; index++) {
    const response = await request.post(`${apiUrl}/incidents`, {
      headers,
      data: {
        title: `${prefix} ${String(index).padStart(2, '0')}`,
        description: 'Repair this assigned workplace issue.',
        category: 'Equipment',
        building_id: building.id,
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const incident = await response.json()
    cleanup.unshift(`/incidents/${incident.id}`)
    const assignment = await request.patch(`${apiUrl}/incidents/${incident.id}/assignment`, {
      headers,
      data: { assignee_id: user.id },
    })
    expect(assignment.ok()).toBeTruthy()
    assigned.push(await assignment.json())
  }
  const login = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: engineerPassword },
  })
  expect(login.ok()).toBeTruthy()
  const tokens = await login.json()
  const ownResponse = await request.post(`${apiUrl}/incidents`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    data: {
      title: `${prefix} own report`,
      description: 'An issue I personally reported.',
      category: 'Other',
      building_id: building.id,
    },
  })
  expect(ownResponse.ok()).toBeTruthy()
  const own = await ownResponse.json()
  cleanup.unshift(`/incidents/${own.id}`)
  await request.post(`${apiUrl}/auth/logout`, { data: { refresh_token: tokens.refresh_token } })
  return { prefix, user, password: engineerPassword, assigned, own }
}

test('engineer manages assigned incidents, notes and workflow while retaining own reports', async ({
  request,
  page,
}) => {
  test.setTimeout(120000)
  const fixture = await engineerFixture(request, 12)
  const incident = fixture.assigned[0]
  await page.goto('/')
  await signIn(page, fixture.user.email, fixture.password)
  await expect(page).toHaveURL(/\/engineer\/incidents$/)
  await expect(page.getByRole('heading', { name: 'Assigned incidents', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'New incident', exact: true })).toBeHidden()
  await expectSummary(page, 'assigned', {
    'Awaiting acceptance': 12,
    'In progress': 0,
    Blocked: 0,
    Resolved: 0,
  })
  await page.getByRole('combobox', { name: 'Rows per page:', exact: true }).click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(page.getByText('11–12 of 12', { exact: true })).toBeVisible()
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('assignee_id') === String(fixture.user.id) &&
      url.searchParams.get('search') === incident.title &&
      url.searchParams.get('page') === '0'
    )
  })
  await page.getByRole('textbox', { name: 'Search assigned incidents' }).fill(incident.title)
  expect((await searched).status()).toBe(200)
  await expectSummary(page, 'assigned', {
    'Awaiting acceptance': 12,
    'In progress': 0,
    Blocked: 0,
    Resolved: 0,
  })
  await page.getByRole('link', { name: `#${incident.id} · ${incident.title}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: incident.title, exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Priority and escalation', exact: true }),
  ).toBeHidden()
  const accepted = page.waitForResponse(
    (response) =>
      browserPath(new URL(response.url())) === `/incidents/${incident.id}/status` &&
      response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Accept and start work', exact: true }).click()
  const acceptance = await accepted
  expect(acceptance.status()).toBe(200)
  expect((await acceptance.json()).acknowledged_at).toBeTruthy()
  for (const status of ['Blocked', 'In Progress', 'Resolved', 'In Progress', 'Resolved']) {
    await page.getByRole('button', { name: 'Change status', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('combobox', { name: /^Next status/ })
      .click()
    await expect(page.getByRole('option', { name: 'Open', exact: true })).toBeHidden()
    await expect(page.getByRole('option', { name: 'Closed', exact: true })).toBeHidden()
    await page.getByRole('option', { name: status, exact: true }).click()
    if (status === 'Blocked') {
      await expect(
        page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('dialog')
        .getByLabel('Blocked reason')
        .fill('Replacement equipment is on order')
    }
    await save(page, `/incidents/${incident.id}/status`, 'PATCH')
    if (status === 'Blocked') {
      await expect(
        page.getByRole('alert').filter({ hasText: 'Replacement equipment is on order' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Add note', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByLabel('Note', { exact: false })
        .fill('I have ordered the replacement and will update you when it arrives.')
      await save(page, `/incidents/${incident.id}/notes`)
      await expect(
        page.getByText('I have ordered the replacement and will update you when it arrives.', {
          exact: true,
        }),
      ).toBeVisible()
      await page.setViewportSize({ width: 320, height: 640 })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1)
      await page.screenshot({
        path: test.info().outputPath('engineer-blocked-mobile.png'),
        fullPage: true,
      })
    } else
      await expect(page.getByRole('alert').filter({ hasText: 'Work is blocked:' })).toBeHidden()
    if (status === 'Resolved') {
      await page.getByRole('button', { name: 'Add note', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByLabel('Note', { exact: false })
        .fill('Engineer follow-up after resolution')
      await save(page, `/incidents/${incident.id}/notes`)
      await expect(
        page.getByText('Engineer follow-up after resolution', { exact: true }).last(),
      ).toBeVisible()
    }
  }
  await expect(page.getByRole('button', { name: 'Change status', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('tab', { name: 'Assigned to me', exact: true }).click()
  await expectSummary(page, 'assigned', {
    'Awaiting acceptance': 11,
    'In progress': 0,
    Blocked: 0,
    Resolved: 1,
  })
  await page.screenshot({
    path: test.info().outputPath('engineer-summary-mobile.png'),
    fullPage: true,
  })
  const closed = await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
    headers,
    data: { status: 'Closed' },
  })
  expect(closed.status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expectSummary(page, 'assigned', {
    'Awaiting acceptance': 11,
    'In progress': 0,
    Blocked: 0,
    Resolved: 0,
  })
  await page.getByRole('textbox', { name: 'Search assigned incidents' }).fill(incident.title)
  await page.getByRole('link', { name: `#${incident.id} · ${incident.title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Change status', exact: true })).toBeHidden()
  await page.reload()
  await page.getByRole('textbox', { name: 'Search assigned incidents' }).fill(incident.title)
  await page.getByRole('link', { name: `#${incident.id} · ${incident.title}`, exact: true }).click()
  await expect(
    page.getByText('I have ordered the replacement and will update you when it arrives.', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('tab', { name: 'My incidents', exact: true }).click()
  await expectSummary(page, 'personal', { Active: 1, Resolved: 0, Closed: 0 })
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: `#${fixture.own.id} · ${fixture.own.title}`, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: `#${incident.id} · ${incident.title}`, exact: true }),
  ).toBeHidden()
  await page
    .getByRole('link', { name: `#${fixture.own.id} · ${fixture.own.title}`, exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Change status', exact: true })).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Priority and escalation', exact: true }),
  ).toBeHidden()
})

test('engineer scope and permissions follow current assignment including reassignment', async ({
  request,
  page,
}) => {
  const fixture = await engineerFixture(request)
  const incident = fixture.assigned[0]
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(browserApiUrl)) reads.push(browserPath(new URL(request.url())))
  })
  await page.goto('/admin/users')
  await signIn(page, fixture.user.email, fixture.password)
  await expect(page).toHaveURL(/\/engineer\/incidents$/)
  const accessToken = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('acme.admin.session')!).access_token,
  )
  const engineerHeaders = { Authorization: `Bearer ${accessToken}` }
  const all = await (await request.get(`${apiUrl}/incidents`, { headers })).json()
  const other = all.find(
    (row: { reporter_id: number; assignee_id: number | null }) =>
      row.assignee_id !== fixture.user.id && row.reporter_id !== fixture.user.id,
  )
  expect(
    (await request.get(`${apiUrl}/incidents/${other.id}`, { headers: engineerHeaders })).status(),
  ).toBe(403)
  for (const [path, data] of [
    [`/incidents/${other.id}/status`, { status: 'In Progress' }],
    [`/incidents/${fixture.own.id}/status`, { status: 'In Progress' }],
    [`/incidents/${incident.id}/assignment`, { assignee_id: null }],
    [`/incidents/${incident.id}/priority`, { priority: 'High' }],
  ] as const)
    expect(
      (await request.patch(`${apiUrl}${path}`, { headers: engineerHeaders, data })).status(),
    ).toBe(403)
  expect(
    (
      await request.delete(`${apiUrl}/incidents/${incident.id}`, { headers: engineerHeaders })
    ).status(),
  ).toBe(403)
  await page.goto(`/engineer/incidents/${fixture.own.id}`)
  await expect(page.getByRole('alert')).toContainText('not currently assigned to you')
  await expect(page.getByRole('heading', { name: fixture.own.title, exact: true })).toBeHidden()
  expect(reads).not.toContain(`/incidents/${fixture.own.id}/notes`)
  await page.goto(`/engineer/incidents/${incident.id}`)
  await expect(page.getByRole('heading', { name: incident.title, exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Accept and start work', exact: true }),
  ).toBeVisible()
  const replacement = (
    await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json()
  ).find((row: { user_id: number }) => row.user_id !== fixture.user.id)
  expect(
    (
      await request.patch(`${apiUrl}/incidents/${incident.id}/assignment`, {
        headers,
        data: { assignee_id: replacement.user_id },
      })
    ).ok(),
  ).toBeTruthy()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Incident access denied')
  await expect(
    page.getByRole('button', { name: 'Accept and start work', exact: true }),
  ).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeHidden()
  expect(
    (
      await request.post(`${apiUrl}/incidents/${incident.id}/notes`, {
        headers: engineerHeaders,
        data: { body: 'No longer assigned' },
      })
    ).status(),
  ).toBe(403)
  expect(
    (
      await request.patch(`${apiUrl}/incidents/${incident.id}/status`, {
        headers: engineerHeaders,
        data: { status: 'In Progress' },
      })
    ).status(),
  ).toBe(403)
  await page.getByRole('tab', { name: 'Assigned to me', exact: true }).click()
  await expect(page.getByText('No records to show', { exact: true })).toBeVisible()
  await expectSummary(page, 'assigned', { 'In progress': 0, Blocked: 0, Resolved: 0 })
  expect(reads.some((path) => /^\/(users|engineer-profiles)(\/|$)/.test(path))).toBeFalsy()
  expect(
    reads
      .filter((path) => /^\/reports(\/|$)/.test(path))
      .every((path) => path === '/reports/summary'),
  ).toBeTruthy()
})

test('an admin engineer switches views while keeping incident scopes, member controls and the same login', async ({
  request,
  page,
}) => {
  test.setTimeout(120000)
  const suffix = `workspace${Date.now()}`
  const actorPassword = 'workspace-password-12345'
  const actor = await (
    await request.post(`${apiUrl}/users`, {
      data: { name: suffix, email: `${suffix}@acme.inc`, password: actorPassword },
    })
  ).json()
  cleanup.unshift(`/users/${actor.id}`)
  expect(
    (
      await request.patch(`${apiUrl}/users/${actor.id}/admin`, {
        headers,
        data: { is_admin: true },
      })
    ).ok(),
  ).toBeTruthy()
  expect(
    (
      await request.post(`${apiUrl}/engineer-profiles`, { headers, data: { user_id: actor.id } })
    ).ok(),
  ).toBeTruthy()
  cleanup.unshift(`/engineer-profiles/${actor.id}`)
  const tokens = await (
    await request.post(`${apiUrl}/auth/login`, {
      data: { email: actor.email, password: actorPassword },
    })
  ).json()
  const actorHeaders = { Authorization: `Bearer ${tokens.access_token}` }
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const incidentData = (title: string) => ({
    title,
    description: 'Workspace scope verification.',
    category: 'Other',
    building_id: building.id,
  })
  const own = await (
    await request.post(`${apiUrl}/incidents`, {
      headers: actorHeaders,
      data: incidentData(`${suffix} own`),
    })
  ).json()
  const assigned = await (
    await request.post(`${apiUrl}/incidents`, { headers, data: incidentData(`${suffix} assigned`) })
  ).json()
  cleanup.unshift(`/incidents/${own.id}`, `/incidents/${assigned.id}`)
  expect(
    (
      await request.patch(`${apiUrl}/incidents/${assigned.id}/assignment`, {
        headers,
        data: { assignee_id: actor.id },
      })
    ).ok(),
  ).toBeTruthy()
  let logins = 0
  page.on('request', (req) => {
    if (browserPath(new URL(req.url())) === '/auth/login') logins++
  })
  await page.goto('/admin/incidents')
  await signIn(page, actor.email, actorPassword)
  await expect(page.getByRole('button', { name: 'New incident', exact: true })).toBeVisible()
  await switchWorkspace(page, 'My incidents')
  await expect(page).toHaveURL(/\/employee\/incidents$/)
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await expect(page.getByText('1–1 of 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'My incident summary' })).toBeVisible()
  await page.getByRole('link', { name: `#${own.id} · ${own.title}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: own.title, exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Assign engineer', exact: true })).toBeHidden()
  await expect(dialog.getByRole('button', { name: 'Delete incident', exact: true })).toBeHidden()
  await dialog.getByRole('link', { name: building.name, exact: true }).click()
  const scoped = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('building_id') === String(building.id) &&
      url.searchParams.get('reporter_id') === String(actor.id)
    )
  })
  await dialog.getByRole('link', { name: 'View incidents', exact: true }).click()
  expect((await (await scoped).json()).row_count).toBe(1)
  await expect(dialog.getByRole('link', { name: assigned.title, exact: true })).toBeHidden()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'New incident', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: /^Priority/ })).toBeHidden()
  await dialog.getByLabel('Title', { exact: false }).fill(`${suffix} submitted`)
  await dialog.getByLabel('Description').fill('An admin reporting in the employee view.')
  await select(page, 'Category', 'Other')
  await select(page, 'Building', building.name)
  const created = await save(page, '/incidents')
  expect(created.reporter_id).toBe(actor.id)
  expect(created.priority).toBe('Low')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await switchWorkspace(page, 'Assigned to me')
  await expect(page).toHaveURL(/\/engineer\/incidents$/)
  await expect(page.getByText('1–1 of 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Assigned incident summary' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveText(
    'Assigned to me',
  )
  await page.getByRole('link', { name: `#${assigned.id} · ${assigned.title}`, exact: true }).click()
  const accepted = page.waitForResponse(
    (response) =>
      browserPath(new URL(response.url())) === `/incidents/${assigned.id}/status` &&
      response.request().method() === 'PATCH',
  )
  await dialog.getByRole('button', { name: 'Accept and start work', exact: true }).click()
  expect((await (await accepted).json()).status).toBe('In Progress')
  await dialog.getByRole('button', { name: 'Change status', exact: true }).click()
  await dialog.getByRole('combobox', { name: /^Next status/ }).click()
  await expect(page.getByRole('option', { name: 'Closed', exact: true })).toBeHidden()
  await page.getByRole('option', { name: 'Resolved', exact: true }).click()
  await save(page, `/incidents/${assigned.id}/status`, 'PATCH')
  await expect(dialog.getByRole('button', { name: 'Add note', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await switchWorkspace(page, 'Administration')
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(assigned.title)
  await page.getByRole('link', { name: assigned.title, exact: true }).click()
  await dialog.getByRole('button', { name: 'Change status', exact: true }).click()
  await select(page, 'Next status', 'Closed')
  expect((await save(page, `/incidents/${assigned.id}/status`, 'PATCH')).status).toBe('Closed')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(logins).toBe(1)
  await request.post(`${apiUrl}/auth/logout`, { data: { refresh_token: tokens.refresh_token } })
})

test('an admin without an engineer profile can switch to employee view and cannot open assigned workspace', async ({
  request,
  page,
}) => {
  const suffix = `adminviews${Date.now()}`
  const actorPassword = 'admin-views-password-12345'
  const actor = await (
    await request.post(`${apiUrl}/users`, {
      data: { name: suffix, email: `${suffix}@acme.inc`, password: actorPassword },
    })
  ).json()
  cleanup.unshift(`/users/${actor.id}`)
  expect(
    (
      await request.patch(`${apiUrl}/users/${actor.id}/admin`, {
        headers,
        data: { is_admin: true },
      })
    ).ok(),
  ).toBeTruthy()
  await page.goto('/admin/incidents')
  await signIn(page, actor.email, actorPassword)
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(2)
  await expect(page.getByRole('option', { name: 'Assigned to me', exact: true })).toBeHidden()
  await page.getByRole('option', { name: 'My incidents', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await page.goto('/engineer/incidents')
  await expect(page).toHaveURL(/\/admin\/incidents$/)
  await switchWorkspace(page, 'My incidents')
  expect(
    (
      await request.patch(`${apiUrl}/users/${actor.id}/admin`, {
        headers,
        data: { is_admin: false },
      })
    ).ok(),
  ).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My incidents', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toBeHidden()
  await page.goto('/admin/incidents')
  await expect(page).toHaveURL(/\/employee\/incidents$/)
})
