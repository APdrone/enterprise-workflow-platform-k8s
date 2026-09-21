/**
 * Pact Record-Deployment CLI Helper
 * Records a successful deployment of a service version to an environment.
 *
 * Usage:
 *   npx tsx scripts/pact-record-deployment.ts --pacticipant workflow-api --version 1.0.0 --environment qa
 */

import process from 'node:process';

export {};

const args = process.argv.slice(2);

function getArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
}

const pacticipant = getArg('--pacticipant', 'workflow-api');
const version = getArg('--version', process.env.GIT_SHA || process.env.npm_package_version || '1.0.0');
const environment = getArg('--environment', 'qa');
const brokerUrl = process.env.PACT_BROKER_URL || 'http://localhost:9292';
const brokerToken = process.env.PACT_BROKER_TOKEN;

async function recordDeployment() {
  console.log(`[Pact Broker] Recording deployment of ${pacticipant} v${version} to environment '${environment}'...`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (brokerToken) {
    headers['Authorization'] = `Bearer ${brokerToken}`;
  }

  const url = `${brokerUrl}/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version)}/deployed-versions/environment/${encodeURIComponent(environment)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetUrl: process.env.DEPLOY_TARGET_URL || undefined,
      }),
    });

    if (res.ok || res.status === 201) {
      console.log(`✅ [Pact Broker] Successfully recorded deployment of ${pacticipant} v${version} to '${environment}'.`);
    } else {
      console.warn(`[Pact Broker] Response status ${res.status}`);
    }
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      console.warn(`⚠️ [Pact Broker] Broker offline at ${brokerUrl}. Deployment record skipped.`);
    } else {
      console.error('[Pact Broker] Error recording deployment:', err.message);
    }
  }
}

recordDeployment().catch((err) => {
  console.error('[Pact Broker] Error:', err);
});
