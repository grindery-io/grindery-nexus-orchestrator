import Analytics from "analytics-node";
const analytics = process.env.SEGMENT_WRITE_KEY
  ? new Analytics(process.env.SEGMENT_WRITE_KEY, {
      flushInterval: 100,
    })
  : null;

export function track(accountId: string, event: string, properties: { [key: string]: unknown } = {}) {
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
