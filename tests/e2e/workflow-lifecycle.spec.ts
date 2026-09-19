import { test, expect } from '@playwright/test';

test.describe('Workflow Platform End-to-End User Journeys', () => {
  test('Multi-Tenant Data Isolation Test: Data from Tenant A is strictly invisible to Tenant B', async ({
    page,
  }) => {
    // 1. Open Host App as Tenant A
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // Ensure Tenant A is selected
    const tenantSelector = page.getByTestId('tenant-selector');
    await tenantSelector.selectOption('tenant-corp-a');

    // Create a uniquely identifiable expense in Tenant A
    const uniqueTitle = `TenantA-Secret-${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(uniqueTitle);
    await page.getByTestId('expense-amount-input').fill('1500');
    await page.getByTestId('expense-desc-input').fill('Confidential budget item for Corp A');
    await page.getByTestId('submit-create-btn').click();

    // Verify it is visible in Tenant A's table
    await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 5000 });

    // 2. Switch Tenant to Tenant B
    await tenantSelector.selectOption('tenant-corp-b');
    await page.waitForTimeout(1000);

    // Verify Tenant A's secret workflow is NOT visible in Tenant B
    await expect(page.getByText(uniqueTitle)).not.toBeVisible();
  });

  test('Full Lifecycle: Create Draft -> Submit -> Approver Signs Off -> Verify Audit Log', async ({
    page,
  }) => {
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');

    // 1. Select Tenant A and Requester (Alice)
    await page.getByTestId('tenant-selector').selectOption('tenant-corp-a');
    await page.getByTestId('user-selector').selectOption('user-alice');

    // 2. Create new Draft Expense
    const expenseTitle = `MacBook Pro M3 Max - ${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(expenseTitle);
    await page.getByTestId('expense-amount-input').fill('3499');
    await page.getByTestId('expense-desc-input').fill('Development workstation for ML workloads');
    await page.getByTestId('submit-create-btn').click();

    // Click on created item
    await page.getByText(expenseTitle).click();

    // Verify Initial Status is DRAFT
    const statusBadge = page.getByTestId('workflow-status-badge');
    await expect(statusBadge).toHaveText(/Draft/i);

    // 3. Submit for Approval
    const submitBtn = page.getByTestId('submit-workflow-btn');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Status updates to PENDING
    await expect(statusBadge).toHaveText(/Pending/i, { timeout: 5000 });

    // 4. Switch persona to Approver (Bob Smith)
    await page.getByTestId('user-selector').selectOption('user-bob');
    await page.getByTestId('nav-approvals-link').click();

    // Find and select the item in approvals inbox
    await page.getByText(expenseTitle).click();

    // Click Approve
    const approveBtn = page.getByTestId('approve-workflow-btn');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Status updates to APPROVED
    await expect(page.getByTestId('workflow-status-badge')).toHaveText(/Approved/i, { timeout: 5000 });

    // 5. Verify Compliance Audit Trail
    await page.getByTestId('nav-audit-link').click();
    await page.waitForTimeout(500);

    // Audit timeline should be visible
    const timeline = page.getByTestId('audit-timeline');
    await expect(timeline).toBeVisible({ timeout: 5000 });
  });
});
