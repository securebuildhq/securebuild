// SecurelyDeleteFile: Secure Deletion and Build Safety
//
// This helper overwrites a file with zeros and then deletes it, to reduce the risk of sensitive data (like cosign keys) being recovered from disk.
//
// Performance Impact:
// - For small files (like cosign keys, typically <5KB), the overhead is negligible (well under a millisecond per file).
// - Even at high scale (e.g., thousands of builds in parallel across many servers), the total I/O is tiny compared to image build/push/scan operations.
// - The only "slow" part is the disk sync, but for small files this is very fast on modern disks.
// - The real bottlenecks in CI/build systems are almost always CPU, network, or large file I/O, not secure deletion of small temp files.
//
// Inode and Path Behavior:
// - Each build creates its own temp directory (os.MkdirTemp), so cosign.key files are isolated per build.
// - When a file is deleted, its inode may eventually be reused, but not immediately and not predictably.
// - Creating a new file at the same path in a new temp dir will get a new inode.
//
// Back-to-Back Builds:
// - There is no risk of interference between builds, as each uses a unique temp directory.
// - The deferred secure delete runs at the end of the build step, before the next build starts.
// - Unless temp dirs are reused (which this code does not do), there is no risk of one build's delete affecting another.
//
// What Could Go Wrong?
// - If the same temp dir is reused for multiple builds at the same time (not the case here), there could be a race.
// - If a build crashes before the deferred delete runs, the key file remains until the temp dir is cleaned up (same as any deferred cleanup).
//
// Summary Table:
// | Scenario                        | Risk of Inode/Path Collision? | SecureDelete Interference? |
// |----------------------------------|:----------------------------:|:-------------------------:|
// | Each build uses unique temp dir  | No                           | No                        |
// | Builds run back-to-back          | No                           | No                        |
// | Builds reuse same temp dir       | Yes (but our code does not)  | Possible                  |
//
// Conclusion:
// - This approach is safe for parallel and sequential builds as long as each uses its own temp directory.
// - The deferred delete will not mess up the next build.
// - The performance impact is negligible for your use case.

package cosign

import (
	"os"
)

// SecurelyDeleteFile overwrites the file with zeros and then deletes it.
func SecurelyDeleteFile(path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		// If the file doesn't exist, treat as success
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return err
	}

	size := fi.Size()
	if size > 0 {
		zeros := make([]byte, 4096)
		var written int64
		for written < size {
			toWrite := int64(len(zeros))
			if size-written < toWrite {
				toWrite = size - written
			}
			if _, err := f.Write(zeros[:toWrite]); err != nil {
				return err
			}
			written += toWrite
		}
		// Ensure data is flushed to disk
		f.Sync()
	}
	f.Close()
	return os.Remove(path)
}
