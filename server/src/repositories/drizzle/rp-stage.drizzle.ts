/**
 * DrizzleRpStageRepository — назначения этапа «РП» (rp_stage_assignees, миграция 0016).
 * Один сотрудник на объект гарантируется UNIQUE(construction_site_id); гонка вставки
 * транслируется в ConflictError (409).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { rpStageAssignees, constructionSites, users } from '../../db/schema/index.js';
import type {
  RpStageRepository,
  RpStageAssignee,
  RpStageCandidate,
} from '../rp-stage.repository.js';
import { ConflictError, ValidationError } from '../types.js';
import { getPgErrorCode, PG_UNIQUE_VIOLATION } from './errors.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleRpStageRepository implements RpStageRepository {
  constructor(private readonly db: Db) {}

  async listAssignees(): Promise<RpStageAssignee[]> {
    return this.db
      .select({
        id: rpStageAssignees.id,
        userId: rpStageAssignees.userId,
        userFullName: users.fullName,
        userEmail: users.email,
        userDepartment: users.departmentId,
        siteId: rpStageAssignees.constructionSiteId,
        siteName: constructionSites.name,
      })
      .from(rpStageAssignees)
      .innerJoin(users, eq(users.id, rpStageAssignees.userId))
      .innerJoin(constructionSites, eq(constructionSites.id, rpStageAssignees.constructionSiteId))
      .orderBy(asc(constructionSites.name));
  }

  async addAssignee(siteId: string, userId: string): Promise<void> {
    const [candidate] = await this.db
      .select({ role: users.role, isActive: users.isActive, department: users.departmentId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (
      !candidate ||
      !candidate.isActive ||
      !['admin', 'user'].includes(candidate.role) ||
      !['shtab', 'omts'].includes(candidate.department ?? '')
    ) {
      throw new ValidationError('Назначить можно только активного сотрудника отдела Штаб или ОМТС');
    }

    const [site] = await this.db
      .select({ id: constructionSites.id })
      .from(constructionSites)
      .where(eq(constructionSites.id, siteId))
      .limit(1);
    if (!site) throw new ValidationError('Объект строительства не найден');

    try {
      await this.db.insert(rpStageAssignees).values({ constructionSiteId: siteId, userId });
    } catch (err) {
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictError('На объект уже назначен сотрудник РП');
      }
      throw err;
    }
  }

  async removeAssignee(id: string): Promise<void> {
    await this.db.delete(rpStageAssignees).where(eq(rpStageAssignees.id, id));
  }

  async listCandidates(): Promise<RpStageCandidate[]> {
    return this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        department: users.departmentId,
      })
      .from(users)
      .where(
        and(
          inArray(users.departmentId, ['shtab', 'omts']),
          eq(users.isActive, true),
          inArray(users.role, ['admin', 'user']),
        ),
      )
      .orderBy(asc(users.fullName));
  }

  async getAssigneeSiteIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ siteId: rpStageAssignees.constructionSiteId })
      .from(rpStageAssignees)
      .where(eq(rpStageAssignees.userId, userId));
    return rows.map((r) => r.siteId);
  }
}
