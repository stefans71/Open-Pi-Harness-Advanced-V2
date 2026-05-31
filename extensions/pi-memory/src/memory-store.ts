import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import * as sqliteVec from "sqlite-vec";
import type { StorageConfig, SharedConfig } from "./config.js";

export interface Fact {
	id: string;
	content: string;
	source: "compaction" | "manual" | "session_end";
	importance: number;
	createdAt: string;
	lastAccessed: string;
	accessCount: number;
	sessionId?: string;
}

export interface FactWithScore extends Fact {
	score: number;
}

export interface MemoryStats {
	totalFacts: number;
	manualFacts: number;
	extractedFacts: number;
	dbSizeKB: number;
}

export class MemoryStore {
	private db: Database.Database | null = null;
	private config: StorageConfig;
	private shared: SharedConfig;

	constructor(config: StorageConfig, shared: SharedConfig) {
		this.config = config;
		this.shared = shared;
	}

	initialize(): void {
		const dir = dirname(this.config.dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(this.config.dbPath);
		this.db.pragma("journal_mode = WAL");
		sqliteVec.load(this.db);

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS facts (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'compaction',
				importance REAL DEFAULT 0.5,
				created_at TEXT NOT NULL,
				last_accessed TEXT NOT NULL,
				access_count INTEGER DEFAULT 0,
				session_id TEXT
			);

			CREATE VIRTUAL TABLE IF NOT EXISTS fact_vectors USING vec0(
				id TEXT PRIMARY KEY,
				embedding FLOAT[${this.shared.embeddingDimension}]
			);
		`);
	}

	storeFact(params: {
		content: string;
		embedding: Float32Array;
		source: Fact["source"];
		importance: number;
		sessionId?: string;
	}): string {
		this.ensureOpen();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		const isDuplicate = this.checkDuplicate(params.embedding, 0.95);
		if (isDuplicate) return isDuplicate;

		this.db!.prepare(`
			INSERT INTO facts (id, content, source, importance, created_at, last_accessed, session_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).run(id, params.content, params.source, params.importance, now, now, params.sessionId ?? null);

		this.db!.prepare(`
			INSERT INTO fact_vectors (id, embedding) VALUES (?, ?)
		`).run(id, Buffer.from(params.embedding.buffer));

		this.enforceMaxFacts();
		return id;
	}

	searchFacts(queryEmbedding: Float32Array, topK: number): FactWithScore[] {
		this.ensureOpen();

		const now = new Date().toISOString();
		const updateAccess = this.db!.prepare(`
			UPDATE facts SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?
		`);

		const rows = this.db!.prepare(`
			SELECT f.id, f.content, f.source, f.importance,
				f.created_at, f.last_accessed, f.access_count, f.session_id,
				v.distance
			FROM fact_vectors v
			JOIN facts f ON f.id = v.id
			WHERE v.embedding MATCH ? AND k = ?
			ORDER BY v.distance
		`).all(Buffer.from(queryEmbedding.buffer), topK) as {
			id: string;
			content: string;
			source: string;
			importance: number;
			created_at: string;
			last_accessed: string;
			access_count: number;
			session_id: string | null;
			distance: number;
		}[];

		return rows.map((row) => {
			updateAccess.run(now, row.id);
			return {
				id: row.id,
				content: row.content,
				source: row.source as Fact["source"],
				importance: row.importance,
				createdAt: row.created_at,
				lastAccessed: now,
				accessCount: row.access_count + 1,
				sessionId: row.session_id ?? undefined,
				score: 1 - row.distance,
			};
		});
	}

	deleteFact(id: string): void {
		this.ensureOpen();
		this.db!.prepare("DELETE FROM facts WHERE id = ?").run(id);
		this.db!.prepare("DELETE FROM fact_vectors WHERE id = ?").run(id);
	}

	getStats(): MemoryStats {
		this.ensureOpen();
		const total = (this.db!.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number }).c;
		const manual = (
			this.db!.prepare("SELECT COUNT(*) as c FROM facts WHERE source = 'manual'").get() as { c: number }
		).c;

		let dbSizeKB = 0;
		if (existsSync(this.config.dbPath)) {
			dbSizeKB = Math.round(statSync(this.config.dbPath).size / 1024);
		}

		return {
			totalFacts: total,
			manualFacts: manual,
			extractedFacts: total - manual,
			dbSizeKB,
		};
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	private checkDuplicate(embedding: Float32Array, threshold: number): string | null {
		const results = this.db!.prepare(`
			SELECT id, distance FROM fact_vectors
			WHERE embedding MATCH ? AND k = 1
			ORDER BY distance
		`).all(Buffer.from(embedding.buffer)) as { id: string; distance: number }[];

		if (results.length > 0 && 1 - results[0].distance > threshold) {
			return results[0].id;
		}
		return null;
	}

	private enforceMaxFacts(): void {
		const count = (this.db!.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number }).c;
		if (count <= this.config.maxFacts) return;

		const toDelete = count - this.config.maxFacts;
		const ids = this.db!
			.prepare(
				`SELECT id FROM facts ORDER BY importance ASC, last_accessed ASC LIMIT ?`,
			)
			.all(toDelete) as { id: string }[];

		const del = this.db!.prepare("DELETE FROM facts WHERE id = ?");
		const delVec = this.db!.prepare("DELETE FROM fact_vectors WHERE id = ?");
		for (const { id } of ids) {
			del.run(id);
			delVec.run(id);
		}
	}

	private ensureOpen(): void {
		if (!this.db) throw new Error("MemoryStore not initialized. Call initialize() first.");
	}
}
