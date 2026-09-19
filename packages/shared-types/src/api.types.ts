import { Workflow, WorkflowStatus } from './workflow.types.js';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ListWorkflowsQuery {
  status?: WorkflowStatus;
  requesterId?: string;
  approverId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedWorkflowsResponse {
  workflows: Workflow[];
  total: number;
  limit: number;
  offset: number;
}
