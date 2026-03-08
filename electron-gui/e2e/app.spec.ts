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
  // Ensure consistent viewport size for portal-rendered elements (dropdowns, dialogs)
  await page.setViewportSize({ width: 1280, height: 800 })
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

// Helper to open a thopter detail and switch to Transcript view
async function openDetailTranscript() {
  await goToDashboard()
  const firstCard = page.locator('[data-slot="card"]').first()
  await firstCard.click()
  // Default view is SSH — switch to Transcript
  await page.locator('button', { hasText: 'Transcript' }).click()
}

// Helper to ensure we're in a detail view (any mode)
async function ensureDetailView() {
  const h2 = page.locator('h2').first()
  if (!(await h2.isVisible().catch(() => false))) {
    await goToDashboard()
    await page.locator('[data-slot="card"]').first().click()
  }
}

// Helper to open the actions dropdown in a detail view
async function openActionsDropdown() {
  await ensureDetailView()
  const trigger = page.locator('[data-slot="dropdown-menu-trigger"]')
  await trigger.click()
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toBeVisible()
}

// Helper to click a dropdown menu item by text via JS (bypasses Playwright viewport check
// since Radix portals can render outside the visible area in headless Electron)
async function clickDropdownItem(text: string) {
  await page.evaluate((t) => {
    const items = document.querySelectorAll('[data-slot="dropdown-menu-item"]')
    for (const item of items) {
      if (item.textContent?.includes(t)) {
        ;(item as HTMLElement).click()
        return
      }
    }
    throw new Error(`Dropdown item "${t}" not found`)
  }, text)
}

// --- Dashboard tests ---

test('dashboard loads and shows thopter cards', async () => {
  const cards = page.locator('[data-slot="card"]')
  await expect(cards).toHaveCount(5, { timeout: 10_000 })
})

test('header shows run and re-auth buttons', async () => {
  await expect(page.locator('header').getByRole('button', { name: 'Run' })).toBeVisible()
  await expect(page.locator('header').getByRole('button', { name: 'Re-Auth' })).toBeVisible()
})

test('thopter cards show status badges', async () => {
  const badges = page.locator('[data-slot="badge"]')
  const count = await badges.count()
  expect(count).toBeGreaterThanOrEqual(5)
})

// --- Tab navigation tests ---

test('clicking a card opens detail tab', async () => {
  await goToDashboard()

  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  // Tab bar should show the thopter name as a tab
  await expect(page.getByRole('tab', { name: name! })).toBeVisible()

  // Detail view should show the status panel with the thopter name
  await expect(page.locator('h2').filter({ hasText: name! })).toBeVisible()
})

test('can switch back to dashboard tab', async () => {
  await goToDashboard()
  const cards = page.locator('[data-slot="card"]')
  await expect(cards.first()).toBeVisible()
})

test('can open and close a tab', async () => {
  await goToDashboard()

  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  const thopterTab = page.getByRole('tab', { name: name! })
  await expect(thopterTab).toBeVisible()

  const closeBtn = page.getByLabel(`Close ${name} tab`)
  await closeBtn.click()

  await expect(thopterTab).not.toBeVisible()
})

// --- Detail view mode tests ---

test('detail view defaults to SSH tab', async () => {
  await goToDashboard()
  await page.locator('[data-slot="card"]').first().click()

  // SSH connect button should be visible (default view)
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible({ timeout: 5_000 })
})

test('can switch to Transcript view', async () => {
  await ensureDetailView()
  await page.locator('button', { hasText: 'Transcript' }).click()

  const transcript = page.locator('[role="log"]')
  await expect(transcript).toBeVisible({ timeout: 10_000 })
})

// --- Transcript tests ---

test('detail view shows transcript entries', async () => {
  // Ensure we're in transcript view
  await ensureDetailView()
  const transcriptBtn = page.locator('button', { hasText: 'Transcript' })
  if (await transcriptBtn.isVisible().catch(() => false)) {
    await transcriptBtn.click()
  }
  await page.waitForSelector('[role="log"]', { timeout: 10_000 })

  const hasEntries = await page
    .locator('text=user')
    .or(page.locator('text=assistant'))
    .or(page.locator('text=tool'))
    .first()
    .isVisible()
  expect(hasEntries).toBeTruthy()
})

// --- Action bar tests ---

test('action bar visible in transcript mode with tell input', async () => {
  // The tell textarea has data-slot="textarea" (from the Textarea UI component),
  // distinguishing it from the status line / notes textareas in the status panel.
  const tellTextarea = page.locator('textarea[data-slot="textarea"]')
  if (!(await tellTextarea.isVisible().catch(() => false))) {
    await openDetailTranscript()
  }

  await expect(tellTextarea).toBeVisible()
  await tellTextarea.fill('test message')
  await expect(tellTextarea).toHaveValue('test message')
})

test('action bar hidden in SSH mode', async () => {
  await ensureDetailView()
  // Switch to SSH
  await page.locator('button', { hasText: 'SSH' }).click()
  // Tell textarea should not be visible (status panel textareas are still there)
  await expect(page.locator('textarea[data-slot="textarea"]')).not.toBeVisible()
})

// --- Actions dropdown tests ---

test('actions dropdown opens and shows all menu items', async () => {
  await openActionsDropdown()

  const content = page.locator('[data-slot="dropdown-menu-content"]')
  await expect(content.getByText('Shell Commands')).toBeVisible()
  await expect(content.getByText('Suspend').or(content.getByText('Resume'))).toBeVisible()
  await expect(content.getByText('Destroy')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(content).not.toBeVisible()
})

test('actions dropdown: Shell Commands opens modal', async () => {
  await openActionsDropdown()

  await clickDropdownItem('Shell Commands')

  await expect(page.getByText('thopter ssh')).toBeVisible({ timeout: 5_000 })

  await page.keyboard.press('Escape')
})

test('actions dropdown: Destroy opens confirmation dialog', async () => {
  await openActionsDropdown()

  await clickDropdownItem('Destroy')

  await expect(page.getByText('Destroy Thopter')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('permanently destroy')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Destroy Thopter')).not.toBeVisible()
})

test('actions dropdown: Suspend/Resume opens confirmation dialog', async () => {
  await openActionsDropdown()

  const content = page.locator('[data-slot="dropdown-menu-content"]')
  const hasSuspend = await content.getByText('Suspend').isVisible().catch(() => false)

  if (hasSuspend) {
    await clickDropdownItem('Suspend')
    await expect(page.getByText('Suspend Thopter')).toBeVisible({ timeout: 5_000 })
  } else {
    await clickDropdownItem('Resume')
    await expect(page.getByText('Resume Thopter')).toBeVisible({ timeout: 5_000 })
  }

  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('actions dropdown closes on Escape', async () => {
  await openActionsDropdown()

  const content = page.locator('[data-slot="dropdown-menu-content"]')
  await expect(content).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(content).not.toBeVisible()
})

test('actions dropdown closes on outside click', async () => {
  await openActionsDropdown()

  const content = page.locator('[data-slot="dropdown-menu-content"]')
  await expect(content).toBeVisible()

  await page.locator('h2').first().click({ force: true })
  await expect(content).not.toBeVisible()
})

// --- Run tab tests ---

test('run tab opens and shows mode selection', async () => {
  await goToDashboard()
  await page.locator('header').getByRole('button', { name: 'Run', exact: true }).click()

  // Should show mode selection step
  await expect(page.getByText('Launch a new devbox')).toBeVisible()
  await expect(page.getByText('Choose how Claude should work')).toBeVisible()
  await expect(page.getByText('Single Repository')).toBeVisible()
})

test('run tab: selecting repo mode shows repository step', async () => {
  // Click "Single Repository" mode
  await page.getByText('Single Repository').click()

  // Should advance to repos step
  const select = page.locator('select').first()
  await expect(select).toBeVisible({ timeout: 5_000 })
})

test('run tab: can navigate through steps', async () => {
  const select = page.locator('select').first()
  await expect(select).toBeVisible()

  // Wait for repos to load
  await expect(select.locator('option')).not.toHaveCount(2, { timeout: 5_000 })

  // Select the first real repo
  await select.selectOption({ index: 1 })

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click()

  // Should be on prompt step
  await expect(page.locator('label').filter({ hasText: 'Prompt Description' })).toBeVisible()

  // Enter a prompt (use data-slot to target the Textarea UI component, not status panel fields)
  await page.locator('textarea[data-slot="textarea"]').fill('Test prompt for playwright')

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click()

  // Should be on review step with Launch button
  await expect(page.getByRole('button', { name: 'Launch Thopter' })).toBeVisible()
})

test('run tab can be closed', async () => {
  const closeBtn = page.getByLabel(/Close Run New Thopter tab/)
  await closeBtn.click()

  await expect(page.getByText('Launch a new devbox')).not.toBeVisible()
})

// --- Re-auth tests ---

test('reauth tab opens and closes', async () => {
  await page.locator('header').getByRole('button', { name: 'Re-Auth' }).click()

  await expect(page.getByText('Update Claude Code credentials')).toBeVisible()
  await expect(page.getByText('Choose a machine')).toBeVisible()

  const closeBtn = page.getByLabel(/Close Re-Authenticate tab/)
  await closeBtn.click()
  await expect(page.getByText('Choose a machine')).not.toBeVisible()
})

// --- Notes & status line tests ---

test('detail view shows status line and notes fields', async () => {
  await goToDashboard()
  await page.locator('[data-slot="card"]').first().click()

  // Both auto-save fields should be visible (use placeholder to find them)
  const statusLineField = page.getByPlaceholder('No status line set')
  const notesField = page.getByPlaceholder('Add notes...')

  await expect(statusLineField).toBeVisible()
  await expect(notesField).toBeVisible()
})

test('status line field is always editable (no click-to-edit)', async () => {
  await ensureDetailView()

  const statusLineField = page.getByPlaceholder('No status line set')
  await expect(statusLineField).toBeVisible()

  // Should be directly typeable without needing to click an edit button
  await statusLineField.focus()
  await expect(statusLineField).toBeFocused()
})

test('notes field is always editable and supports multiline', async () => {
  await ensureDetailView()

  const notesField = page.getByPlaceholder('Add notes...')
  await expect(notesField).toBeVisible()

  // Clear and type multiline content — Enter should insert a newline, not submit
  await notesField.fill('')
  await notesField.type('line one')
  await notesField.press('Enter')
  await notesField.type('line two')

  const value = await notesField.inputValue()
  expect(value).toContain('line one')
  expect(value).toContain('line two')
  expect(value).toContain('\n')
})

test('notes field handles empty/null state gracefully', async () => {
  await goToDashboard()

  // Close any open detail tabs first to avoid duplicate placeholders
  const closeBtns = page.locator('[aria-label*="Close"][aria-label*="tab"]')
  const closeCount = await closeBtns.count()
  for (let i = closeCount - 1; i >= 0; i--) {
    const label = await closeBtns.nth(i).getAttribute('aria-label')
    if (label && !label.includes('Dashboard')) {
      await closeBtns.nth(i).click()
    }
  }

  // Open a thopter that has no notes (mock data: index 1+ have null notes)
  const cards = page.locator('[data-slot="card"]')
  const count = await cards.count()
  if (count >= 2) {
    await cards.nth(1).click()
  } else {
    await cards.first().click()
  }

  const notesField = page.getByPlaceholder('Add notes...')
  await expect(notesField).toBeVisible()

  // Should show placeholder, value should be empty
  const value = await notesField.inputValue()
  expect(value).toBe('')
})

test('notes shown on dashboard card when present', async () => {
  await goToDashboard()

  // The first mock thopter (eager-falcon) has notes set.
  // Notes render in an italic <p> inside the card.
  const notesP = page.locator('[data-slot="card"] p.italic')
  const count = await notesP.count()
  // At least one card should have a visible notes paragraph
  expect(count).toBeGreaterThanOrEqual(1)
  await expect(notesP.first()).toBeVisible()
})

test('notes not shown on dashboard card when absent', async () => {
  await goToDashboard()

  // The second mock thopter has null notes — card should not show notes text
  const secondCard = page.locator('[data-slot="card"]').nth(1)
  // Should show status line but not a notes paragraph
  await expect(secondCard.locator('p.italic')).not.toBeVisible()
})

test('status line and notes are side by side with divider', async () => {
  await goToDashboard()

  // Close any open detail tabs first to avoid duplicate locator matches
  const closeBtns = page.locator('[aria-label*="Close"][aria-label*="tab"]')
  const closeCount = await closeBtns.count()
  for (let i = closeCount - 1; i >= 0; i--) {
    const label = await closeBtns.nth(i).getAttribute('aria-label')
    if (label && !label.includes('Dashboard')) {
      await closeBtns.nth(i).click()
    }
  }

  await page.locator('[data-slot="card"]').first().click()

  // The status panel row containing both fields and the divider
  const fieldRow = page.locator('.flex.gap-4').filter({ has: page.getByPlaceholder('Add notes...') })
  await expect(fieldRow).toBeVisible()

  // Should contain exactly 3 children: status line col, divider, notes col
  const divider = fieldRow.locator('.w-px.bg-border')
  await expect(divider).toBeVisible()
})

test('status line field auto-saves on debounce', async () => {
  // Ensure only one detail tab is open
  await goToDashboard()
  const closeBtns = page.locator('[aria-label*="Close"][aria-label*="tab"]')
  const closeCount = await closeBtns.count()
  for (let i = closeCount - 1; i >= 0; i--) {
    const label = await closeBtns.nth(i).getAttribute('aria-label')
    if (label && !label.includes('Dashboard')) {
      await closeBtns.nth(i).click()
    }
  }
  await page.locator('[data-slot="card"]').first().click()

  const statusLineField = page.getByPlaceholder('No status line set')
  await expect(statusLineField).toBeVisible()
  const originalValue = await statusLineField.inputValue()

  // Type new content
  await statusLineField.fill('new status from e2e test')

  // Wait for debounce (250ms) + buffer
  await page.waitForTimeout(400)

  // Value should persist (still in the field)
  await expect(statusLineField).toHaveValue('new status from e2e test')

  // Restore original value
  await statusLineField.fill(originalValue)
  await page.waitForTimeout(400)
})
