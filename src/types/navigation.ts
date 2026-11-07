// Router `location.state` shapes shared between pages.
import type { NotificationStatusFilter } from "./notifications";

export interface ChatFromNotification {
  id: string;
  title: string;
  /** Inbox tab to return to. */
  status: NotificationStatusFilter;
}

export interface ChatLocationState {
  /** Opened from the behavior-alerts panel (admin). */
  fromAlert?: boolean;
  advisorName?: string;
  /** Opened from an agent notification — shows the "back to notification" banner. */
  fromNotification?: ChatFromNotification;
  /** wam_id of the message to scroll to and highlight (the receipt file). */
  focusWamId?: string;
}
