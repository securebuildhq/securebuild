import { createDebugArchive } from "@/lib/execution/execution";
import { NextRequest, NextResponse } from "next/server";
import * as fs from 'fs';
import { Readable } from 'stream';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const executionID = searchParams.get("executionID");
  if (!executionID) {
    return NextResponse.json({ error: "Execution ID is required" }, { status: 400 });
  }

  let tarFilename: string | null = null;

  try {
    // Create the tar.gz file
    tarFilename = await createDebugArchive(executionID);

    // Create a read stream for the file
    const stream = fs.createReadStream(tarFilename);
    
    // Clean up the file after the stream is consumed
    const tempFile = tarFilename;
    stream.on('end', () => {
      if (tempFile) {
        fs.unlink(tempFile, (err) => {
          if (err) console.error("Error cleaning up tar file:", err);
        });
      }
    });
    
    // Convert Node.js stream to Web Stream
    const webStream = Readable.toWeb(stream) as ReadableStream;

    // Return the tar.gz file as a stream
    return new Response(webStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="reproduce-${executionID}.tar.gz"`,
      },
    });
  } catch (error) {
    console.error("Error creating debug archive:", error);
    // Clean up if there was an error
    if (tarFilename) {
      try {
        await fs.promises.unlink(tarFilename);
      } catch (cleanupError) {
        console.error("Error cleaning up tar file:", cleanupError);
      }
    }
    return NextResponse.json({ error: "Failed to create debug archive" }, { status: 500 });
  }
}
