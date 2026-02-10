import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [resolve(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, THOPTER_MOCK: '1' },
  })
  page = await app.firstWindow()
  // Wait for React to mount and data to load
  await page.waitForSelector('[data-slot="card"]', { timeout: 10_000 })
})

test.afterAll(async () => {
  await app.close()
})

// Helper to navigate to dashboard tab reliably
async function goToDashboard() {
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.locator('[data-slot="card"]').first()).toBeVisible()
}

// --- Dashboard tests ---

test('dashboard loads and shows thopter cards', async () => {
  const cards = page.locator('[data-slot="card"]')
  await expect(cards).toHaveCount(5, { timeout: 10_000 })
})

test('header shows app title and buttons', async () => {
  await expect(page.locator('h1')).toHaveText('Thopter Swarm')
  await expect(page.getByText('Run New Thopter')).toBeVisible()
  await expect(page.getByText('Re-Authenticate')).toBeVisible()
})

test('thopter cards show status badges', async () => {
  const badges = page.locator('[data-slot="badge"]')
  const count = await badges.count()
  expect(count).toBeGreaterThanOrEqual(5)
})

// --- Tab navigation tests ---

test('clicking a card opens detail tab', async () => {
  await goToDashboard()

  // Click the first thopter card
  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  // Tab bar should show the thopter name as a tab
  await expect(page.getByRole('tab', { name: name! })).toBeVisible()

  // Detail view should show the status panel with the thopter name in h2
  await expect(page.locator('h2').filter({ hasText: name! })).toBeVisible()
})

test('can switch back to dashboard tab', async () => {
  await goToDashboard()
  // Should see the card grid again
  const cards = page.locator('[data-slot="card"]')
  await expect(cards.first()).toBeVisible()
})

test('can open and close a tab', async () => {
  await goToDashboard()

  // Open a thopter tab
  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  // Verify tab exists
  const thopterTab = page.getByRole('tab', { name: name! })
  await expect(thopterTab).toBeVisible()

  // Find and click the close button (aria-label="Close <name> tab")
  const closeBtn = page.getByLabel(`Close ${name} tab`)
  await closeBtn.click()

  // Tab should be gone and we're back to dashboard
  await expect(thopterTab).not.toBeVisible()
})

// --- Transcript tests ---

test('detail view shows transcript entries', async () => {
  await goToDashboard()

  // Click a thopter card to open detail
  const firstCard = page.locator('[data-slot="card"]').first()
  await firstCard.click()

  // Wait for transcript to load - the transcript view has role="log"
  const transcript = page.locator('[role="log"]')
  await expect(transcript).toBeVisible({ timeout: 10_000 })

  // Check that transcript entries are visible (they have role labels)
  const hasEntries = await page
    .locator('text=user')
    .or(page.locator('text=assistant'))
    .or(page.locator('text=tool'))
    .first()
    .isVisible()
  expect(hasEntries).toBeTruthy()
})

// --- Action bar tests ---

test('tell input exists and can type', async () => {
  // Should still be in detail view from previous test
  // If not, navigate there
  const textarea = page.locator('textarea')
  if (!(await textarea.isVisible().catch(() => false))) {
    await goToDashboard()
    await page.locator('[data-slot="card"]').first().click()
  }

  await expect(textarea).toBeVisible()
  await textarea.fill('test message')
  await expect(textarea).toHaveValue('test message')
})

test('operation buttons are visible', async () => {
  // Should still be in detail view
  const textarea = page.locator('textarea')
  if (!(await textarea.isVisible().catch(() => false))) {
    await goToDashboard()
    await page.locator('[data-slot="card"]').first().click()
  }

  await expect(page.getByText('Suspend').or(page.getByText('Resume'))).toBeVisible()
  await expect(page.getByText('Destroy')).toBeVisible()
  await expect(page.getByText('Attach')).toBeVisible()
})

// --- Run modal tests ---

test('run modal opens and shows form', async () => {
  await goToDashboard()
  await page.getByText('Run New Thopter').click()

  // Modal should be visible with title
  await expect(page.getByText('Launch a new devbox')).toBeVisible()

  // Should show repository step
  await expect(page.locator('label').filter({ hasText: 'Repository' })).toBeVisible()
})

test('run modal can navigate steps', async () => {
  // Modal should still be open from previous test
  const select = page.locator('select').first()
  await expect(select).toBeVisible()

  // Wait for repos to load (mock has 100ms delay + React render)
  await expect(select.locator('option')).not.toHaveCount(2, { timeout: 5_000 })

  // Select the first real repo
  await select.selectOption({ index: 1 })

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click()

  // Should be on prompt step
  await expect(page.locator('label').filter({ hasText: 'Task Description' })).toBeVisible()

  // Enter a prompt
  await page.locator('textarea').fill('Test task for playwright')

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click()

  // Should be on review step with Launch button
  await expect(page.getByRole('button', { name: 'Launch Thopter' })).toBeVisible()
})

test('run modal can be closed', async () => {
  // Close the modal via the dialog close button or pressing Escape
  await page.keyboard.press('Escape')

  // Modal should be gone
  await expect(page.getByText('Launch a new devbox')).not.toBeVisible()
})

// --- Notification sidebar tests ---

test('notification sidebar opens and closes', async () => {
  // Click the notification bell button
  const bellBtn = page.getByLabel(/Notifications/)
  await bellBtn.click()

  // Sidebar should show
  await expect(page.getByText('Events from your thopter fleet')).toBeVisible({ timeout: 5_000 })

  // Close it by pressing Escape (Sheet responds to Escape)
  await page.keyboard.press('Escape')

  // Wait for sidebar to animate out
  await expect(page.getByText('Events from your thopter fleet')).not.toBeVisible({ timeout: 5_000 })
})

// --- Re-auth modal tests ---

test('reauth modal opens', async () => {
  // Make sure sidebar is fully closed first
  await page.waitForTimeout(500)

  await page.getByText('Re-Authenticate').click()

  // Should show the reauth modal
  await expect(page.getByText('Update Claude Code credentials')).toBeVisible()
  await expect(page.getByText('Choose a machine')).toBeVisible()

  // Close it
  await page.keyboard.press('Escape')
  await expect(page.getByText('Update Claude Code credentials')).not.toBeVisible()
})
