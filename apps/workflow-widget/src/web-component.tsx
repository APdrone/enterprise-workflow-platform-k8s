import React from 'react';
import ReactDOM from 'react-dom/client';
import { WorkflowWidget } from './WorkflowWidget.js';

export class WorkflowWidgetElement extends HTMLElement {
  private mountPoint: HTMLDivElement;
  private root: ReactDOM.Root | null = null;

  static get observedAttributes() {
    return ['workflow-id', 'api-url', 'tenant-id', 'user-id', 'user-name', 'user-role'];
  }

  constructor() {
    super();
    // Use light DOM or shadow DOM depending on encapsulation preference
    this.mountPoint = document.createElement('div');
    this.mountPoint.className = 'workflow-widget-root';
  }

  connectedCallback() {
    this.appendChild(this.mountPoint);
    this.root = ReactDOM.createRoot(this.mountPoint);
    this.render();
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    if (!this.root) return;

    const workflowId = this.getAttribute('workflow-id') || '';
    const apiUrl = this.getAttribute('api-url') || 'http://localhost:3000';
    const tenantId = this.getAttribute('tenant-id') || '';
    const userId = this.getAttribute('user-id') || 'user-default';
    const userName = this.getAttribute('user-name') || 'Default User';
    const userRole = (this.getAttribute('user-role') as any) || 'requester';

    this.root.render(
      <React.StrictMode>
        <WorkflowWidget
          workflowId={workflowId}
          apiUrl={apiUrl}
          tenantId={tenantId}
          userId={userId}
          userName={userName}
          userRole={userRole}
          onStatusChange={(status, workflow) => {
            this.dispatchEvent(
              new CustomEvent('workflow-status-change', {
                detail: { status, workflow },
                bubbles: true,
                composed: true,
              })
            );
          }}
          onError={(error) => {
            this.dispatchEvent(
              new CustomEvent('workflow-error', {
                detail: { error },
                bubbles: true,
                composed: true,
              })
            );
          }}
        />
      </React.StrictMode>
    );
  }
}

// Register custom element
if (!customElements.get('workflow-widget')) {
  customElements.define('workflow-widget', WorkflowWidgetElement);
}

export { WorkflowWidget };
