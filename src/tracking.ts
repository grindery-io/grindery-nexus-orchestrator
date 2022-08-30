import Analytics from "analytics-node";
import { getWorkflowEnvironment } from "./utils";
const analytics = process.env.SEGMENT_WRITE_KEY
  ? new Analytics(process.env.SEGMENT_WRITE_KEY, {
      flushInterval: 100,
    })
  : null;

export function track(accountId: string, event: string, properties: { [key: string]: unknown } = {}) {
  if (properties.envirnment === "staging") {
    return;
  }
  if (properties.workflow && getWorkflowEnvironment((properties.workflow as string).toString()) === "staging") {
    return;
  }
  analytics?.track({
    userId: accountId,
    event,
    properties,
  });
}

export function identify(accountId: string, traits: { [key: string]: unknown }) {
  analytics?.identify({
    userId: accountId,
    traits,
  });
}
