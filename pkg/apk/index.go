package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"strings"
)

func ExtractAPKIndex(path string) (*APKIndex, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			// File doesn't exist, return empty index
			return &APKIndex{Packages: []map[string]string{}}, nil
		}
		return nil, err
	}
	defer f.Close()

	// Empty file is treated as an empty index
	stat, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to stat file %s: %w", path, err)
	}
	if stat.Size() == 0 {
		return &APKIndex{Packages: []map[string]string{}}, nil
	}

	// Read the file - it's just a single gzip stream containing a tar archive
	fileData, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", path, err)
	}

	// Extract APKINDEX content (whether signed or unsigned)
	indexContent, err := extractAPKIndexFromArchive(fileData)
	if err != nil {
		return nil, fmt.Errorf("failed to extract APKINDEX content: %w", err)
	}

	if len(indexContent) == 0 {
		return &APKIndex{Packages: []map[string]string{}}, nil
	}

	return parseAPKIndexContent(indexContent)
}

// Extract APKINDEX content from archive (handles both signed and unsigned)
func extractAPKIndexFromArchive(data []byte) ([]byte, error) {
	reader := bytes.NewReader(data)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, fmt.Errorf("invalid gzip: %w", err)
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid tar: %w", err)
		}

		if header.Name == "APKINDEX" {
			indexContent, err := io.ReadAll(tarReader)
			if err != nil {
				return nil, fmt.Errorf("failed to read APKINDEX content: %w", err)
			}
			return indexContent, nil
		}

		// Skip signature files - we don't need them for extraction
		if strings.HasPrefix(header.Name, ".SIGN.RSA.") {
			fmt.Printf("DEBUG: Skipping signature file: %s\n", header.Name)
			continue
		}
	}

	return nil, fmt.Errorf("no APKINDEX file found in archive")
}

// Parse the APKINDEX content into APKIndex struct
func parseAPKIndexContent(indexContent []byte) (*APKIndex, error) {
	pkgs := strings.Split(string(indexContent), "\n\n")
	var parsed []map[string]string

	for _, pkg := range pkgs {
		lines := strings.Split(pkg, "\n")
		meta := make(map[string]string)
		for _, line := range lines {
			if line == "" || !strings.Contains(line, ":") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			meta[key] = val
		}
		if len(meta) > 0 {
			parsed = append(parsed, meta)
		}
	}

	return &APKIndex{Packages: parsed}, nil
}

func writeAPKIndex(path string, index *APKIndex) error {
	var buf bytes.Buffer

	for _, meta := range index.Packages {
		if meta["C"] == "" || meta["P"] == "" || meta["V"] == "" {
			continue
		}

		buf.WriteString(fmt.Sprintf("C:%s\n", strings.TrimSpace(meta["C"])))
		buf.WriteString(fmt.Sprintf("P:%s\n", strings.TrimSpace(meta["P"])))

		version := meta["V"]
		if !strings.Contains(version, "-r") && meta["r"] != "" {
			version = fmt.Sprintf("%s-r%s", version, meta["r"])
		}
		buf.WriteString(fmt.Sprintf("V:%s\n", strings.TrimSpace(version)))
		buf.WriteString(fmt.Sprintf("A:%s\n", strings.TrimSpace(meta["A"])))
		buf.WriteString(fmt.Sprintf("S:%s\n", strings.TrimSpace(meta["S"])))

		if meta["I"] != "" {
			buf.WriteString(fmt.Sprintf("I:%s\n", strings.TrimSpace(meta["I"])))
		} else {
			buf.WriteString("I:0\n")
		}

		buf.WriteString(fmt.Sprintf("T:%s\n", strings.TrimSpace(meta["T"])))

		if meta["U"] != "" {
			buf.WriteString(fmt.Sprintf("U:%s\n", strings.TrimSpace(meta["U"])))
		} else {
			buf.WriteString("U:https://securebuild.com\n")
		}

		buf.WriteString(fmt.Sprintf("L:%s\n", strings.TrimSpace(meta["L"])))
		buf.WriteString(fmt.Sprintf("o:%s\n", strings.TrimSpace(meta["o"])))
		if m := strings.TrimSpace(meta["m"]); m != "" {
			buf.WriteString(fmt.Sprintf("m:%s\n", m))
		}
		buf.WriteString(fmt.Sprintf("t:%d\n", 1700000000)) // TODO: real epoch

		if meta["c"] != "" {
			buf.WriteString(fmt.Sprintf("c:%s\n", strings.TrimSpace(meta["c"])))
		}

		if meta["D"] != "" {
			buf.WriteString(fmt.Sprintf("D:%s\n", strings.TrimSpace(meta["D"])))
		}

		if meta["p"] != "" {
			buf.WriteString(fmt.Sprintf("p:%s\n", strings.TrimSpace(meta["p"])))
		}

		// only one \n needed here b/c we are ending each line above with \n
		buf.WriteString("\n")
	}

	apkIndexContent := buf.Bytes()

	var out bytes.Buffer
	gz := gzip.NewWriter(&out)
	tw := tar.NewWriter(gz)

	err := tw.WriteHeader(&tar.Header{
		Name: "APKINDEX",
		Mode: 0644,
		Size: int64(len(apkIndexContent)),
	})
	if err != nil {
		return err
	}

	_, err = tw.Write(apkIndexContent)
	if err != nil {
		return err
	}

	tw.Close()
	gz.Close()

	return os.WriteFile(path, out.Bytes(), 0644)
}
