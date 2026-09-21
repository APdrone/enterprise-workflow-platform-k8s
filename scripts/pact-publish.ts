import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export {};

const PACT_BROKER_URL = process.env.PACT_BROKER_URL || 'http://localhost:9292';
const PACT_BROKER_TOKEN = process.env.PACT_BROKER_TOKEN;
const PACT_DIR = path.resolve(process.cwd(), 'pacts');
const APP_VERSION = process.env.GIT_SHA || process.env.npm_package_version || '1.0.0';
const BRANCH = process.env.GIT_BRANCH || 'main';

async function publishPacts() {
  console.log(`[Pact Broker] Publishing pacts to ${PACT_BROKER_URL}...`);
  console.log(`[Pact Broker] Version: ${APP_VERSION} | Branch: ${BRANCH}`);

  if (!fs.existsSync(PACT_DIR)) {
    console.warn(`[Pact Broker] No pact directory found at ${PACT_DIR}. Run "npm run test:pact:consumer" first.`);
    return;
  }

  const files = fs.readdirSync(PACT_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.warn(`[Pact Broker] No pact JSON files found in ${PACT_DIR}.`);
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (PACT_BROKER_TOKEN) {
    headers['Authorization'] = `Bearer ${PACT_BROKER_TOKEN}`;
  }

  let publishedCount = 0;

  for (const file of files) {
    const filePath = path.join(PACT_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const consumer = content.consumer?.name;
    const provider = content.provider?.name;

    if (!consumer || !provider) {
      console.warn(`[Pact Broker] Skipping ${file}: missing consumer or provider name.`);
      continue;
    }

    const url = `${PACT_BROKER_URL}/pacts/provider/${encodeURIComponent(provider)}/consumer/${encodeURIComponent(consumer)}/version/${encodeURIComponent(APP_VERSION)}`;

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(content),
      });

      if (res.ok || res.status === 201 || res.status === 200) {
        console.log(`✓ Published ${file} (${consumer} -> ${provider})`);
        publishedCount++;
      } else {
        const text = await res.text();
        console.error(`✗ Failed to publish ${file}: HTTP ${res.status} - ${text}`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        console.warn(`⚠️ [Pact Broker] Broker offline at ${PACT_BROKER_URL}. Pact file ${file} remains saved locally.`);
      } else {
        console.error(`✗ Error publishing ${file}:`, err.message);
      }
    }
  }

  console.log(`[Pact Broker] Published ${publishedCount} / ${files.length} contracts.`);
}

publishPacts().catch((err) => {
  console.error('[Pact Broker] Fatal publish error:', err);
  process.exit(0);
});
