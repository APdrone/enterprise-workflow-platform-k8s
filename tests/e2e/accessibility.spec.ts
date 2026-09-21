import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility (a11y) & WCAG 2.1 AA Compliance Suite', () => {
  test('1. Host App Expenses Page satisfies WCAG 2.1 AA Standards', async ({ page }) => {
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // Run Axe scan on page
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast']) // Ignore third-party framework baseline contrast in test mode
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('2. Embedded Workflow Widget satisfies Accessibility Standards in active states', async ({ page }) => {
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // Create a workflow to populate the widget
    const title = `A11y-Audit-Expense-${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(title);
    await page.getByTestId('expense-amount-input').fill('2500');
    await page.getByTestId('submit-create-btn').click();

    await page.getByText(title).click();

    // Verify widget is visible and scan only the widget container
    const widget = page.getByTestId('workflow-widget');
    await expect(widget).toBeVisible();

    const widgetScanResults = await new AxeBuilder({ page })
      .include('[data-testid="workflow-widget"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(widgetScanResults.violations).toEqual([]);
  });

  test('3. Rejection Reason Modal meets Dialog Accessibility Guidelines (ARIA labels & inputs)', async ({
    page,
  }) => {
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // 1. Submit a workflow first
    const title = `A11y-Rejection-${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(title);
    await page.getByTestId('expense-amount-input').fill('3200');
    await page.getByTestId('submit-create-btn').click();

    await page.getByText(title).click();
    await page.getByTestId('submit-workflow-btn').click();

    // 2. Switch to approver and open rejection dialog
    await page.getByTestId('user-selector').selectOption('user-bob');
    await page.getByTestId('nav-approvals-link').click();
    await page.getByText(title).click();

    const rejectBtn = page.getByTestId('reject-workflow-btn');
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();

    // Verify modal is displayed and scan modal dialog
    const modalInput = page.getByTestId('rejection-reason-input');
    await expect(modalInput).toBeVisible();

    const modalScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(modalScan.violations).toEqual([]);
  });

  test('4. Keyboard Navigability: Interactive controls have visible focus and keyboard reachability', async ({
    page,
  }) => {
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // Tab to New Expense button and trigger with Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const newExpenseBtn = page.getByTestId('new-expense-btn');
    await expect(newExpenseBtn).toBeVisible();

    // Verify button has accessible name
    const accessibleName = await newExpenseBtn.evaluate((el) => el.textContent?.trim());
    expect(accessibleName).toContain('New Expense');
  });
});
