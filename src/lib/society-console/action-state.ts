/** What every society-console Server Action answers with. Shared by the
 *  actions (server) and the forms (client), so it lives apart from both. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Changes on every answer, so a form can tell a new reply from an old one. */
  at?: number;
};

export const IDLE: ActionState = {};
