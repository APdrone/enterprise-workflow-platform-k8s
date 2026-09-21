/**
 * Kafka Default Partitioner Simulation (Murmur2 Hash)
 * Implements Apache Kafka's org.apache.kafka.common.utils.Utils.murmur2 algorithm.
 * Used for deterministic event routing and strict partition-level ordering tests.
 */

export function murmur2(data: Buffer): number {
  const length = data.length;
  const seed = 0x9747b28c;
  const m = 0x5bd1e995;
  const r = 24;

  let h = seed ^ length;
  const length4 = length >> 2;

  for (let i = 0; i < length4; i++) {
    const i4 = i << 2;
    let k =
      (data[i4]! & 0xff) |
      ((data[i4 + 1]! & 0xff) << 8) |
      ((data[i4 + 2]! & 0xff) << 16) |
      ((data[i4 + 3]! & 0xff) << 24);
    k = Math.imul(k, m);
    k ^= k >>> r;
    k = Math.imul(k, m);
    h = Math.imul(h, m);
    h ^= k;
  }

  const extra = length & 3;
  if (extra === 3) {
    h ^= (data[length - 1]! & 0xff) << 16;
  }
  if (extra >= 2) {
    h ^= (data[length - 2]! & 0xff) << 8;
  }
  if (extra >= 1) {
    h ^= data[length - extra]! & 0xff;
    h = Math.imul(h, m);
  }

  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;

  return h;
}

export function toPositive(n: number): number {
  return n & 0x7fffffff;
}

export function computeKafkaPartition(key: string | Buffer, numPartitions: number): number {
  if (numPartitions <= 0) throw new Error('numPartitions must be > 0');
  const keyBytes = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  return toPositive(murmur2(keyBytes)) % numPartitions;
}
