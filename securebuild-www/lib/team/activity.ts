import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { Activity, ImageUsage } from "../types/activity";
import { listServiceAccounts } from "./service-account";


export async function listTeamRecentActivity(teamId: string, limit: number): Promise<Activity[]> {
  const teamServiceAccounts = await listServiceAccounts(teamId);

  try {
    const db = getDB(await getParam("DB_URI"))
    const query = `select id, created_at, event_type, image_catalog_id, image_name, image_tag, service_account_id
from activity_log
where team_id = $1
order by created_at desc
limit ${limit}`

    const res = await db.query(query, [teamId])

    const activity: Activity[] = [];
    for (const row of res.rows) {
      activity.push({
        id: row.id,
        createdAt: row.created_at,
        eventType: row.event_type,
        imageName: row.image_name,
        imageTag: row.image_tag,
        serviceAccountId: row.service_account_id,
        serviceAccountName: teamServiceAccounts.find(sa => sa.id === row.service_account_id)?.name,
      })
    }

    return activity;
  } catch (err) {
    console.error(err)
    throw err;
  }
}


export async function listRecentUsage(teamId: string, startDate: string, endDate: string): Promise<ImageUsage> {
  try {
    const db = getDB(await getParam("DB_URI"))
    const query = `select image_name, image_tag, count(*) as pull_count
from image_pull
where team_id = $1
and created_at >= $2
and created_at <= $3
group by image_name, image_tag`

    const res = await db.query(query, [teamId, startDate, endDate])

    const imageUsage: ImageUsage = {
      startDate: startDate,
      endDate: endDate,
      pulls: [],
    }

    for (const row of res.rows) {
      imageUsage.pulls.push({
        imageName: row.image_name,
        imageTag: row.image_tag,
        pullCount: row.pull_count,
      })
    }
    return imageUsage;
  } catch (err) {
    console.error(err)
    throw err;
  }
}
