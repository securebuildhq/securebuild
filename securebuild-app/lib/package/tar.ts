"use server"

import * as tar from 'tar-stream';
import { Readable } from 'stream';
import { promisify } from 'util';
import { AdditionalFile, AdditionalFiles } from '../types/package';

export async function archiveAndEncodeAdditionalFiles(files: AdditionalFile[]): Promise<AdditionalFiles | undefined> {
  if (files.length === 0) {
    return undefined;
  }

  // Create tar archive in memory
  const pack = tar.pack();
  const zlib = await import('zlib');
  const gzip = promisify(zlib.gzip);

  // Add each file to the archive
  for (const entry of files) {
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        { 
          name: entry.path,
          size: Buffer.byteLength(entry.content),
          mode: 0o644,
          mtime: new Date()
        },
        entry.content,
        (err?: Error) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  pack.finalize();

  // Collect tar chunks
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', resolve);
    pack.on('error', reject);
  });
  const tarBuffer = Buffer.concat(chunks);

  // Gzip the tar buffer
  const gzipBuffer = await gzip(tarBuffer, { level: 6 });

  // Convert to base64
  const base64Data = gzipBuffer.toString('base64');

  return {
    filename: 'additional-files.tar.gz',
    data: base64Data
  };
}

export async function decodeAndExtractAdditionalFiles(files: AdditionalFiles): Promise<AdditionalFile[]> {
  // Decode base64 data
  const buffer = Buffer.from(files.data, 'base64');

  const extractedFiles: AdditionalFile[] = [];
  const extract = tar.extract();
  const gunzip = await import('zlib').then(zlib => promisify(zlib.gunzip));

  // Gunzip the buffer
  const tarBuffer = await gunzip(buffer);

  // Process each entry in the tar archive
  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header: tar.Header, stream: Readable, next: () => void) => {
      let content = '';
      stream.on('data', (chunk: Buffer) => content += chunk.toString());
      stream.on('end', () => {
        extractedFiles.push({
          id: '', // Will be set by the database
          path: header.name,
          content: content,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        next();
      });
      stream.on('error', (err: Error) => reject(err));
    });

    extract.on('finish', resolve);
    extract.on('error', reject);

    // Write the tar buffer to the extract stream
    extract.write(tarBuffer);
    extract.end();
  });

  return extractedFiles;
}
