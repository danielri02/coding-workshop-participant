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
  await navigate(page, 'Category frequency')
  const categories = await (await request.get(`${apiUrl}/reports/categories`, { headers })).json()
  const other = categories.rows.find((row: { category: string }) => row.category === 'Other')
  const categoryRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: 'Other', exact: true }) })
  await expect(categoryRow.locator('[data-field="incident_count"]')).toHaveText(
    String(other.incident_count),
  )
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
  await page
    .getByRole('grid')
    .locator('.MuiDataGrid-virtualScroller')
    .evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
  await page.getByRole('button', { name: `View incident ${ids[0]}`, exact: true }).click()
  await expect(page.getByRole('dialog').getByText(`${suffix} 00`, { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('combobox', { name: 'Incident scope' }).click()
  await page.getByRole('option', { name: 'My reported incidents', exact: true }).click()
  await expect(page.getByText('1–10 of 12', { exact: true })).toBeVisible()
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

test('incident details expose admin controls and links to notes and engineer profiles', async ({
  request,
  page,
}) => {
  test.setTimeout(90000)
  const suffix = `incidentlinks${Date.now()}`
  const building = (await (await request.get(`${apiUrl}/buildings`, { headers })).json())[0]
  const engineer = (await (await request.get(`${apiUrl}/engineer-profiles`, { headers })).json())[0]
  const engineerUser = await (
    await request.get(`${apiUrl}/users/${engineer.user_id}`, { headers })
  ).json()
  const response = await request.post(`${apiUrl}/incidents`, {
    headers,
    data: {
      title: suffix,
      description: 'Verify incident navigation and admin controls.',
      category: 'Equipment',
      building_id: building.id,
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const incident = await response.json()
  cleanup.unshift(`/incidents/${incident.id}`)
  await page.goto('/admin/incidents')
  await signIn(page)
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  const incidentRow = page.getByRole('grid').locator(`[role="row"][data-id="${incident.id}"]`)
  const openIncident = async () => {
    await page.getByRole('grid').getByRole('link', { name: suffix, exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveAccessibleName(`Incident #${incident.id}`)
  }
  await openIncident()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Assign engineer', exact: true })
    .click()
  await select(page, 'Assigned engineer', engineerUser.name)
  await save(page, `/incidents/${incident.id}/assignment`, 'PATCH')
  await openIncident()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Priority and escalation', exact: true })
    .click()
  await select(page, 'Priority', 'High')
  await save(page, `/incidents/${incident.id}/priority`, 'PATCH')
  await openIncident()
  await page.getByRole('dialog').getByRole('button', { name: 'Change status', exact: true }).click()
  await select(page, 'Next status', 'In Progress')
  await save(page, `/incidents/${incident.id}/status`, 'PATCH')
  await expect(incidentRow.getByRole('gridcell', { name: 'High', exact: true })).toBeVisible()
  await expect(
    incidentRow.getByRole('gridcell', { name: 'In Progress', exact: true }),
  ).toBeVisible()
  await openIncident()
  await page.getByRole('dialog').getByRole('link', { name: engineerUser.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/engineers\\?record=${engineer.user_id}$`))
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Engineer #${engineer.user_id}`)
  await expect(
    page.getByRole('dialog').getByText(engineerUser.email, { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Engineer #${engineer.user_id}`)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/engineers$/)
  await navigate(page, 'Incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  const scroller = page.getByRole('grid').locator('.MuiDataGrid-virtualScroller')
  await scroller.evaluate((element) => {
    element.scrollLeft = 500
  })
  await incidentRow.getByRole('link', { name: engineerUser.name, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(`Engineer #${engineer.user_id}`)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await navigate(page, 'Incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await incidentRow.getByRole('link', { name: 'View notes', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/notes\\?incident=${incident.id}$`))
  await expect(page.getByRole('combobox', { name: 'Incident', exact: true })).toContainText(suffix)
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Note', { exact: false })
    .fill('Navigation works for this incident.')
  await save(page, `/incidents/${incident.id}/notes`)
  await navigate(page, 'Incidents')
  await page.getByRole('textbox', { name: 'Search incidents' }).fill(suffix)
  await openIncident()
  await page.getByRole('dialog').getByRole('link', { name: 'View notes', exact: true }).click()
  await expect(
    page.getByRole('gridcell', { name: 'Navigation works for this incident.', exact: true }),
  ).toBeVisible()
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
  await page.getByRole('combobox', { name: 'Rows per page:', exact: true }).click()
  await page.getByRole('option', { name: '10', exact: true }).click()
  await expect(page.getByText('1–10 of 15', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Go to next page' }).click()
  await expect(page.getByText('11–15 of 15', { exact: true })).toBeVisible()
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
  const incident = await save(page, '/incidents')
  await expect(page).toHaveURL(new RegExp(`/employee/incidents/${incident.id}$`))
  await expect(page.getByRole('heading', { name: suffix, exact: true })).toBeVisible()
  await expect(page.getByText('Awaiting assignment', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign engineer', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Change status', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Priority and escalation', exact: true }).click()
  await select(page, 'Priority', 'High')
  await page.getByRole('dialog').getByLabel('Escalation reason').fill('Unable to join meetings')
  await save(page, `/incidents/${incident.id}/priority`, 'PATCH')
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
  await expect(page.getByRole('heading', { name: suffix, exact: true })).toBeVisible()
  await expect(
    page.getByText('The connection also drops after restarting.', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await page.getByRole('link', { name: 'My incidents', exact: true }).first().click()
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      browserPath(url) === '/incidents/grid' &&
      url.searchParams.get('search') === suffix &&
      url.searchParams.has('reporter_id')
    )
  })
  await page.getByRole('textbox', { name: 'Search my incidents' }).fill(suffix)
  expect((await searched).status()).toBe(200)
  await expect(
    page.getByRole('link', { name: `#${incident.id} · ${suffix}`, exact: true }),
  ).toBeVisible()
  const scrollbar = page.getByRole('grid').locator('.MuiDataGrid-scrollbar--horizontal')
  await expect(scrollbar).toBeVisible()
  await scrollbar.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(
    requested.some((path) => /\/(users|engineer-profiles|reports)(\/|$)/.test(path)),
  ).toBeFalsy()
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
  ] as const)
    expect(
      (await request.patch(`${apiUrl}${path}`, { headers: employeeHeaders, data })).status(),
    ).toBe(403)
  expect(
    (
      await request.delete(`${apiUrl}/incidents/${own[0].id}`, { headers: employeeHeaders })
    ).status(),
  ).toBe(403)
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
