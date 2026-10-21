import { expect, test, type Page } from '@playwright/test'

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
  await expect(page.getByRole('dialog')).toBeHidden()
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
  await expect(page.getByRole('dialog')).toBeHidden()
}

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
  await page.getByRole('button', { name: `Edit floors ${floor.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Floor label').fill('13')
  await save(page, `/floors/${floor.id}`, 'PATCH')

  await navigate(page, 'Seats')
  await page.getByRole('button', { name: 'New seat', exact: true }).click()
  await select(page, 'Floor', `${buildingName} updated · Floor 13`)
  await page.getByRole('dialog').getByLabel('Seat label').fill('A1')
  const seat = await save(page, '/seats')
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
  await select(page, 'Next status', 'In Progress')
  await save(page, `/incidents/${incident.id}/status`, 'PATCH')
  await page.getByRole('button', { name: `More actions for incidents ${incident.id}` }).click()
  await page.getByRole('menuitem', { name: 'View notes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
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
  await expect(
    page.getByRole('gridcell', { name: 'Engineer is working on the printer.', exact: true }),
  ).toBeVisible()
  await remove(page, 'notes', note.id)
  await navigate(page, 'Incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await remove(page, 'incidents', incident.id)
  await navigate(page, 'Engineers')
  await remove(page, 'engineers', user.id)
  await navigate(page, 'Users')
  await remove(page, 'users', user.id)
  await navigate(page, 'Seats')
  await remove(page, 'seats', seat.id)
  await navigate(page, 'Floors')
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

test('non-admin credentials are rejected by the admin workspace', async ({ request, page }) => {
  const employeeEmail = `test.employee.${Date.now()}@acme.inc`
  const employeePassword = 'employee-password-12345'
  const response = await request.post(`${apiUrl}/users`, {
    data: { name: 'Employee', email: employeeEmail, password: employeePassword },
  })
  const user = await response.json()
  cleanup.unshift(`/users/${user.id}`)
  await page.goto('/admin/incidents')
  await signIn(page, employeeEmail, employeePassword)
  await expect(page.getByRole('alert')).toContainText('Facility Admin access')
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden()
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
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert').filter({ hasText: 'This incident is closed' })).toBeVisible()
  await page.getByRole('button', { name: `Edit notes ${note.id}`, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Note', { exact: false }).fill('Resolved and verified')
  await save(page, `/notes/${note.id}`, 'PATCH')
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

test('incident grid sends backend search, pagination and sorting changes', async ({
  request,
  page,
}) => {
  const suffix = `gridcheck${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
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
    cleanup.unshift(`/incidents/${(await response.json()).id}`)
  }
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(page.getByText('11–12 of 12', { exact: true })).toBeVisible()
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
