import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import pg from 'pg';

let cachedDockerAvailable: boolean | null = null;

/**
 * Checks whether a Docker daemon is currently running and accessible.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (cachedDockerAvailable !== null) {
    return cachedDockerAvailable;
  }

  // If explicit TEST_DATABASE_URL is provided, we can test against that instead of launching a container
  if (process.env.TEST_DATABASE_URL) {
    cachedDockerAvailable = true;
    return true;
  }

  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore', timeout: 3000 });
    cachedDockerAvailable = true;
    return true;
  } catch {
    cachedDockerAvailable = false;
    return false;
  }
}

/**
 * Starts an ephemeral PostgreSQL testcontainer or returns connection details.
 */
export async function startTestPostgres(): Promise<{
  container?: StartedPostgreSqlContainer;
  connectionString: string;
  pool: pg.Pool;
  stop: () => Promise<void>;
}> {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    return {
      connectionString: process.env.TEST_DATABASE_URL,
      pool,
      stop: async () => {
        await pool.end();
      },
    };
  }

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('workflow_test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start();

  const connectionString = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString });

  return {
    container,
    connectionString,
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

/**
 * Starts an ephemeral Kafka testcontainer.
 */
export async function startTestKafka(): Promise<{
  container: StartedKafkaContainer;
  bootstrapServers: string;
  stop: () => Promise<void>;
}> {
  const container = await new KafkaContainer('confluentinc/cp-kafka:7.6.1')
    .withExposedPorts(9093)
    .start();

  const bootstrapServers = `${container.getHost()}:${container.getMappedPort(9093)}`;

  return {
    container,
    bootstrapServers,
    stop: async () => {
      await container.stop();
    },
  };
}
