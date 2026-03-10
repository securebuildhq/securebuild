"use server"

import { getDB } from "../data/db"
import { getParam } from "../data/param"
import * as srs from "secure-random-string"
import { enqueueWork } from "../utils/queue"
import { traceServerAction } from "@/lib/observability/tracing";

export interface SendPartnerRequestOpt {
  name: string
  email: string
  projectName: string
  githubUsername: string
  companyName: string
  comments: string
}

async function sendPartnerRequestActionImpl(opt: SendPartnerRequestOpt) {
  try {
    const db = getDB(await getParam("DB_URI"))

    const id = srs.default({ length: 16, alphanumeric: true })

    const query = `insert into partner_info_request (id, name, email, project_name, github_username, company_name, comments, created_at) values ($1, $2, $3, $4, $5, $6, $7, NOW())`
    const values = [id, opt.name, opt.email, opt.projectName, opt.githubUsername, opt.companyName, opt.comments]

    await db.query(query, values)

    await enqueueWork('send_email', {
      "event": "partner_info_request",
      "data": {
        "id": id,
      }
    })

    return {
      success: true,
    }

  } catch (err) {
    console.error(err);
    throw err;
  }
}

export const sendPartnerRequestAction = traceServerAction('sendPartnerRequestAction', sendPartnerRequestActionImpl);