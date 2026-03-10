package llm

var (
	generateApkoSystemPrompt = `
You are a helpful assistant that generates APKO YAML from a Melanage YAML.
When generating the APKO YAML, you should follow the following rules:
- Use the supplied text editor tool to edit files.
- Always use the "create" command to create a new file.
- Always name the file "apko.yaml"

Pay close attention to the Melanage YAML and generate the APKO YAML that matches the Melanage YAML.
- Make sure to supply all common and required environment variables.
- Make sure to create an entrypoint.
- Make sure to list all packages used in the build.


If you decided that you must run-as root/uid:0, do not specific the uid/gid in the users/groups section.
Instead, just use this:

accounts:
  run-as: 0

`

	secureBuildApkRepositoryFormatString = `
When listing the packages, for any package and subpackage built in my melange manifest,
you should specify it in the apko packages as name=version where version is the version of the package in the melange manifest.
So, as an example, if the melange manifest builds a package called "foo" and version "1.0.0", you should list it as "foo=1.0.0-release".
IMPORTANT: You must include the alpine release number in the version string that you pin. Without it, the package will not be installable.
The alpine release number is generally the "epoch" field in the Melange manifest.

A version looks like "packageName-packgeVersion-rReleaseNumber". Note that extra leading r in the release number is required.
USE ONLY FIELDS DEFINED IN THE APKO YAML STRUCTURE BELOW.

You should favor pulling packages from cve0, but fall back to upstream packages if a package is not available in cve0.

You should add ALL of the following items to contents.repositories. Each of these must be present and in this order:

1. %s


You should add the following keys:
1. /home/builder/cve0-signing.rsa.pub
`

	valideApkoFields = "The following Go structs are used to unmarshal APKO yamls.\n" +
		"Do not include fields not listed here:\n\n" +
		"type User struct {\n" +
		"\t// Required: The name of the user\n" +
		"\tUserName string `json:\"username,omitempty\"`\n" +
		"\t// Required: The user ID\n" +
		"\tUID uint32 `json:\"uid,omitempty\"`\n" +
		"\t// Required: The user's group ID\n" +
		"\tGID GID `json:\"gid,omitempty\" yaml:\"gid,omitempty\"`\n" +
		"\t// Optional: The user's shell\n" +
		"\tShell string `json:\"shell,omitempty\"`\n" +
		"\t// Optional: The user's home directory\n" +
		"\tHomeDir string `json:\"homedir,omitempty\"`\n" +
		"}\n\n" +
		"type GID *uint32\n\n" +
		"type Group struct {\n" +
		"\t// Required: The name of the group\n" +
		"\tGroupName string `json:\"groupname,omitempty\"`\n" +
		"\t// Required: The group ID\n" +
		"\tGID uint32 `json:\"gid,omitempty\"`\n" +
		"\t// Required: The list of members of the group\n" +
		"\tMembers []string `json:\"members,omitempty\"`\n" +
		"}\n\n" +
		"type PathMutation struct {\n" +
		"\t// The target path to mutate\n" +
		"\tPath string `json:\"path,omitempty\"`\n" +
		"\t// The type of mutation to perform\n" +
		"\t//\n" +
		"\t// This can be one of: directory, empty-file, hardlink, symlink, permissions\n" +
		"\tType string `json:\"type,omitempty\"`\n" +
		"\t// The mutation's desired user ID\n" +
		"\tUID uint32 `json:\"uid,omitempty\"`\n" +
		"\t// The mutation's desired group ID\n" +
		"\tGID uint32 `json:\"gid,omitempty\"`\n" +
		"\t// The permission bits for the path\n" +
		"\tPermissions uint32 `json:\"permissions,omitempty\"`\n" +
		"\t// The source path to mutate\n" +
		"\tSource string `json:\"source,omitempty\"`\n" +
		"\t// Toggle whether to mutate recursively\n" +
		"\tRecursive bool `json:\"recursive,omitempty\"`\n" +
		"}\n\n" +
		"type BaseImageDescriptor struct {\n" +
		"\t// Required: Path to the base image OCI layout. Right now only local files are supported.\n" +
		"\tImage string `json:\"image,omitempty\" yaml:\"image,omitempty\"`\n" +
		"\t// Required: Path to file representing installed packages in the base image in APKINDEX format.\n" +
		"\t// (Assumes regular Alpine repository layout, that is: set /foo/bar if the index is /foo/bor/{aarch64|x86_64}/APKINDEX\n" +
		"\tAPKIndex string `json:\"apkindex,omitempty\" yaml:\"apkindex,omitempty\"`\n" +
		"}\n\n" +
		"type ImageContents struct {\n" +
		"\t// A list of apk repositories to use for pulling packages at build time,\n" +
		"\t// which are not installed into /etc/apk/repositories in the image (to\n" +
		"\t// install packages at runtime)\n" +
		"\tBuildRepositories []string `json:\"build_repositories,omitempty\" yaml:\"build_repositories,omitempty\"`\n" +
		"\t// A list of apk repositories to use for pulling packages during both the\n" +
		"\t// initial construction of the image, and also at runtime by seeding them\n" +
		"\t// into /etc/apk/repositories in the resulting image.\n" +
		"\tRuntimeRepositories []string `json:\"repositories,omitempty\" yaml:\"repositories,omitempty\"`\n" +
		"\t// A list of public keys used to verify the desired repositories\n" +
		"\tKeyring []string `json:\"keyring,omitempty\" yaml:\"keyring,omitempty\"`\n" +
		"\t// A list of packages to include in the image\n" +
		"\tPackages []string `json:\"packages,omitempty\" yaml:\"packages,omitempty\"`\n" +
		"\t// Optional: Base image to build on top of. Warning: Experimental.\n" +
		"\tBaseImage *BaseImageDescriptor `json:\"baseimage,omitempty\" yaml:\"baseimage,omitempty\" apko:\"experimental\"`\n" +
		"}\n\n" +
		"type ImageEntrypoint struct {\n" +
		"\t// Optional: The type of entrypoint. Only \"service-bundle\" is supported.\n" +
		"\tType string `json:\"type,omitempty\"`\n" +
		"\t// Required: The command of the entrypoint\n" +
		"\tCommand string `json:\"command,omitempty\"`\n" +
		"\t// Optional: The shell fragment of the entrypoint command\n" +
		"\tShellFragment string `json:\"shell-fragment,omitempty\" yaml:\"shell-fragment\"`\n" +
		"\tServices map[string]string `json:\"services,omitempty\"`\n" +
		"}\n\n" +
		"type ImageAccounts struct {\n" +
		"\t// Required: The user to run the container as. This can be a username or UID.\n" +
		"\tRunAs string `json:\"run-as,omitempty\" yaml:\"run-as\"`\n" +
		"\t// Required: List of users to populate the image with\n" +
		"\tUsers []User `json:\"users,omitempty\" yaml:\"users\"`\n" +
		"\t// Required: List of groups to populate the image with\n" +
		"\tGroups []Group `json:\"groups,omitempty\" yaml:\"groups\"`\n" +
		"}\n\n" +
		"type ImageConfiguration struct {\n" +
		"\t// Required: The apk packages in the container image\n" +
		"\tContents ImageContents `json:\"contents,omitempty\" yaml:\"contents,omitempty\"`\n" +
		"\t// Required: The entrypoint of the container image\n" +
		"\t//\n" +
		"\t// This typically is the path to the executable to run. Since many of\n" +
		"\t// images do not include a shell, this should be the full path\n" +
		"\t// to the executable.\n" +
		"\tEntrypoint ImageEntrypoint `json:\"entrypoint,omitempty\" yaml:\"entrypoint,omitempty\"`\n" +
		"\t// Optional: The command of the container image\n" +
		"\t//\n" +
		"\t// These are the additional arguments to pass to the entrypoint.\n" +
		"\tCmd string `json:\"cmd,omitempty\" yaml:\"cmd,omitempty\"`\n" +
		"\t// Optional: The stop signal used to suspend the execution of the containers process\n" +
		"\tStopSignal string `json:\"stop-signal,omitempty\" yaml:\"stop-signal,omitempty\"`\n" +
		"\t// Optional: The working directory of the container\n" +
		"\tWorkDir string `json:\"work-dir,omitempty\" yaml:\"work-dir,omitempty\"`\n" +
		"\t// Optional: Account configuration for the container image\n" +
		"\tAccounts ImageAccounts `json:\"accounts,omitempty\" yaml:\"accounts,omitempty\"`\n" +
		"\t// Optional: List of CPU architectures to build the container image for\n" +
		"\t//\n" +
		"\t// The list of supported architectures is: 386, amd64, arm64, arm/v6, arm/v7, ppc64le, riscv64, s390x, loong64\n" +
		"\tArchs []Architecture `json:\"archs,omitempty\" yaml:\"archs,omitempty\"`\n" +
		"\t// Optional: Envionment variables to set in the container image\n" +
		"\tEnvironment map[string]string `json:\"environment,omitempty\" yaml:\"environment,omitempty\"`\n" +
		"\t// Optional: List of paths mutations\n" +
		"\tPaths []PathMutation `json:\"paths,omitempty\" yaml:\"paths,omitempty\"`\n" +
		"\t// Optional: The link to version control system for this container's source code\n" +
		"\tVCSUrl string `json:\"vcs-url,omitempty\" yaml:\"vcs-url,omitempty\"`\n" +
		"\t// Optional: Annotations to apply to the images manifests\n" +
		"\tAnnotations map[string]string `json:\"annotations,omitempty\" yaml:\"annotations,omitempty\"`\n" +
		"\t// Optional: Path to a local file containing additional image configuration\n" +
		"\t//\n" +
		"\t// The included configuration is deep merged with the parent configuration\n" +
		"\t//\n" +
		"\t// Deprecated: This will be removed in a future release.\n" +
		"\tInclude string `json:\"include,omitempty\" yaml:\"include,omitempty\"`\n" +
		"\t// Optional: A list of volumes to configure\n" +
		"\t//\n" +
		"\t// This is _not_ the same as Paths, but refers to the OCI spec \"volumes\"\n" +
		"\t// field used by some container runtimes (docker) to create volumes at\n" +
		"\t// runtime. For most use cases, this is not needed, but consider using this\n" +
		"\t// when the image requires special volume configuration at runtime for\n" +
		"\t// supported container runtimes.\n" +
		"\tVolumes []string `json:\"volumes,omitempty\" yaml:\"volumes,omitempty\"`\n" +
		"\t// Optional: Configuration to control layering of the OCI image.\n" +
		"\tLayering *Layering `json:\"layering,omitempty\" yaml:\"layering,omitempty\"`\n" +
		"}\n\n"
)
