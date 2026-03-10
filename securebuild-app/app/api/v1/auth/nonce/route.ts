import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeNonce, createAIAgentToken } from '@/lib/data/ai-agent-token'

interface ExchangeNonceRequest {
  nonce: string
}

interface ExchangeNonceResponse {
  token: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ExchangeNonceRequest
    
    // Validate request
    if (!body.nonce || typeof body.nonce !== 'string') {
      return NextResponse.json(
        { error: 'Invalid or missing nonce' },
        { status: 400 }
      )
    }
    
    // Validate nonce and get user context
    const userContext = await validateAndConsumeNonce(body.nonce)
    if (!userContext) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 401 }
      )
    }
    
    // Generate AI agent token with 1-day expiration (server-controlled)
    const { token } = await createAIAgentToken(
      userContext.buildadminUserId,
      1
    )
    
    // Return token only
    const response: ExchangeNonceResponse = {
      token
    }
    
    return NextResponse.json(response)
    
  } catch (error) {
    console.error('Error exchanging nonce for token:', error)
    return NextResponse.json(
      { error: 'Failed to exchange nonce for token' },
      { status: 500 }
    )
  }
}