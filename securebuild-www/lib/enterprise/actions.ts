"use server"

import { getDB } from "../data/db"
import { getParam } from "../data/param"
import * as srs from "secure-random-string"
import { enqueueWork } from "../utils/queue"
import { traceServerAction } from "@/lib/observability/tracing";

export interface SubmitEnterpriseFormResult {
  success: boolean
  error?: string
  submissionId?: string
}

async function submitEnterpriseFormImpl(formData: FormData): Promise<SubmitEnterpriseFormResult> {
  try {
    const name = formData.get("name")?.toString()
    const email = formData.get("email")?.toString()
    const companyName = formData.get("companyName")?.toString()
    const jobTitle = formData.get("jobTitle")?.toString()
    const teamSize = formData.get("teamSize")?.toString()
    const comments = formData.get("comments")?.toString()

    // Validate required fields
    if (!name || !email || !companyName || !jobTitle || !teamSize) {
      return {
        success: false,
        error: "Please fill in all required fields"
      }
    }

    const db = getDB(await getParam("DB_URI"))

    const id = srs.default({ length: 16, alphanumeric: true })

    const query = `insert into enterprise_info_request (id, name, email, company_name, job_title, team_size, comments, created_at) values ($1, $2, $3, $4, $5, $6, $7, NOW())`
    const values = [id, name, email, companyName, jobTitle, teamSize, comments]

    await db.query(query, values)

    await enqueueWork('send_email', {
      "event": "enterprise_info_request",
      "data": {
        "id": id,
      }
    })

    return {
      success: true,
      submissionId: id
    }

  } catch (err) {
    console.error("Enterprise form submission error:", err);
    return {
      success: false,
      error: "An error occurred while submitting your request. Please try again."
    }
  }
}

export const submitEnterpriseForm = traceServerAction('submitEnterpriseForm', submitEnterpriseFormImpl); 