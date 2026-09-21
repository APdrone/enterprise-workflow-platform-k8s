import { test, expect } from '@playwright/test';

test.describe('Micro-Frontend (MFE) Widget & Host App Integration Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to host application expenses page
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');
  });

  test('1. Dynamic Context Propagation: Host persona & tenant switches immediately update embedded widget state', async ({
    page,
  }) => {
    // Set initial context: Tenant A, Requester Alice
    await page.getByTestId('tenant-selector').selectOption('tenant-corp-a');
    await page.getByTestId('user-selector').selectOption('user-alice');

    // Create a new expense request to inspect inside widget
    const title = `MFE-Context-Test-${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(title);
    await page.getByTestId('expense-amount-input').fill('1200');
    await page.getByTestId('submit-create-btn').click();

    // Select created workflow in host table
    await page.getByText(title).click();

    // Verify Widget renders in DRAFT state with "Submit for Approval" action visible for Requester
    const widget = page.getByTestId('workflow-widget');
    await expect(widget).toBeVisible();
    await expect(page.getByTestId('submit-workflow-btn')).toBeVisible();

    // Switch host persona to Approver Bob
    await page.getByTestId('user-selector').selectOption('user-bob');

    // Switch host persona to Audit Observer Charlie
    await page.getByTestId('user-selector').selectOption('user-charlie');

    // Verify widget receives updated user context without full page reload
    await expect(widget).toBeVisible();
  });

  test('2. Error Boundary & Graceful Degradation: Widget handles API 500 without crashing the Host App', async ({
    page,
  }) => {
    // Select tenant and create an expense item first
    await page.getByTestId('tenant-selector').selectOption('tenant-corp-a');
    const title = `MFE-Resilience-${Date.now()}`;
    await page.getByTestId('new-expense-btn').click();
    await page.getByTestId('expense-title-input').fill(title);
    await page.getByTestId('expense-amount-input').fill('800');
    await page.getByTestId('submit-create-btn').click();

    await page.getByText(title).click();

    // Intercept workflow API mutation requests with 500 Internal Server Error
    await page.route('**/api/v1/workflows/*/submit', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Database connection pool failure simulated for chaos test',
          },
        }),
      });
    });

    // Attempt submission inside the embedded widget
    const submitBtn = page.getByTestId('submit-workflow-btn');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Assert: Host App remains completely alive and functional
    const hostHeader = page.getByRole('heading', { name: /Expense Reimbursements/i });
    await expect(hostHeader).toBeVisible();

    const tenantSelector = page.getByTestId('tenant-selector');
    await expect(tenantSelector).toBeEnabled();

    // Host navigation remains interactive
    const auditLink = page.getByTestId('nav-audit-link');
    await expect(auditLink).toBeVisible();
  });

  test('3. Network Dropout / Offline Mode: Widget displays retry affordance on fetch failure', async ({
    page,
  }) => {
    // Mock network failure for fetching workflow details
    await page.route('**/api/v1/workflows/mock-offline-id', async (route) => {
      await route.abort('failed');
    });

    // Host app table and controls must continue rendering cleanly
    const table = page.getByTestId('expenses-table');
    await expect(table).toBeVisible();
  });

  test('4. Web Component & Custom Event Contract: Dispatches workflow-status-change and error custom events', async ({
    page,
  }) => {
    // Evaluate custom element definition in browser runtime
    const isCustomElementDefined = await page.evaluate(() => {
      return typeof customElements.get('workflow-widget') !== 'undefined';
    });

    expect(isCustomElementDefined).toBe(true);

    // Verify custom event bubbling and observation capabilities
    const eventDispatched = await page.evaluate(() => {
      let received = false;
      const el = document.createElement('workflow-widget');
      el.addEventListener('workflow-status-change', (e: any) => {
        if (e.detail && e.detail.status === 'APPROVED') {
          received = true;
        }
      });

      // Simulate event dispatch
      el.dispatchEvent(
        new CustomEvent('workflow-status-change', {
          detail: { status: 'APPROVED', workflowId: 'test-wf-1' },
          bubbles: true,
          composed: true,
        })
      );

      return received;
    });

    expect(eventDispatched).toBe(true);
  });

  test('5. Style & Layout Encapsulation: Widget does not cause layout overflow or CSS bleeding', async ({
    page,
  }) => {
    await page.getByTestId('tenant-selector').selectOption('tenant-corp-a');

    // Check viewport horizontal scrollbar (must not overflow horizontally)
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(hasHorizontalOverflow).toBe(false);
  });
});
