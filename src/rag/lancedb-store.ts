import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import type { EvidenceBlock, EvidenceSource } from "./types.js";
import type { VectorRecord, VectorSearchResult, VectorStore } from "./vector-store.js";

interface LanceVectorRow {
  id: string;
  vector: number[];
  text: string;
  source_json: string;
}

interface LanceVectorSearchRow extends LanceVectorRow {
  _distance?: number;
}

interface LanceTable {
  delete(filter: string): Promise<unknown>;
  add(data: Record<string, unknown>[]): Promise<unknown>;
  vectorSearch(vector: number[]): {
    limit(limit: number): {
      toArray(): Promise<unknown[]>;
    };
  };
  countRows(): Promise<number>;
}

interface LanceConnection {
  close(): void;
  tableNames(): Promise<string[]>;
  openTable(name: string): Promise<LanceTable>;
  createTable(name: string, data: Record<string, unknown>[]): Promise<LanceTable>;
}

const DEFAULT_TABLE_NAME = "message_chunks";

export function getLanceDbPath(config: AppConfig): string {
  return path.join(resolveHomePath(config.storage.dataDir), "vector", "lancedb");
}

function toRow(record: VectorRecord): LanceVectorRow {
  return {
    id: record.id,
    vector: record.vector,
    text: record.evidence.text,
    source_json: JSON.stringify(record.evidence.source),
  };
}

function toLanceData(rows: LanceVectorRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    id: row.id,
    vector: row.vector,
    text: row.text,
    source_json: row.source_json,
  }));
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function toEvidence(row: LanceVectorSearchRow): VectorSearchResult {
  const distance = row._distance ?? 0;
  const vectorScore = 1 / (1 + Math.max(0, distance));

  return {
    id: row.id,
    text: row.text,
    score: vectorScore,
    vectorScore,
    source: JSON.parse(row.source_json) as EvidenceSource,
  };
}

export class LanceDbVectorStore implements VectorStore {
  private constructor(
    private readonly connection: LanceConnection,
    private readonly tableName: string,
  ) {}

  static async connect(uri: string, tableName = DEFAULT_TABLE_NAME): Promise<LanceDbVectorStore> {
    await fs.mkdir(uri, { recursive: true });
    const lancedb = await import("@lancedb/lancedb");
    const connection = (await lancedb.connect(uri)) as LanceConnection;
    return new LanceDbVectorStore(connection, tableName);
  }

  static async connectFromConfig(config: AppConfig, tableName = DEFAULT_TABLE_NAME): Promise<LanceDbVectorStore> {
    return LanceDbVectorStore.connect(getLanceDbPath(config), tableName);
  }

  close(): void {
    this.connection.close();
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const rows = records.map(toRow);
    const data = toLanceData(rows);
    const table = await this.ensureTable(data);
    const ids = rows.map((row) => `'${escapeSqlString(row.id)}'`).join(", ");
    await table.delete(`id IN (${ids})`);
    await table.add(data);
  }

  async search(vector: number[], limit: number): Promise<VectorSearchResult[]> {
    const table = await this.openTableIfExists();
    if (!table) {
      return [];
    }

    const rows = (await table.vectorSearch(vector).limit(limit).toArray()) as LanceVectorSearchRow[];
    return rows.map(toEvidence);
  }

  async count(): Promise<number> {
    const table = await this.openTableIfExists();
    if (!table) {
      return 0;
    }

    return table.countRows();
  }

  private async ensureTable(initialRows: Record<string, unknown>[]): Promise<LanceTable> {
    const table = await this.openTableIfExists();
    if (table) {
      return table;
    }

    return this.connection.createTable(this.tableName, initialRows);
  }

  private async openTableIfExists(): Promise<LanceTable | null> {
    const tableNames = await this.connection.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return null;
    }

    return this.connection.openTable(this.tableName);
  }
}
