const melangePackageNamePattern = /^[a-zA-Z\d][a-zA-Z\d+_.-]*$/;

export function renderPackageNameTemplate(
  template: string,
  name = "example",
  major = 1,
  minor = 2,
): string {
  return template
    .replaceAll("{name}", name)
    .replaceAll("{major}", String(major))
    .replaceAll("{minor}", String(minor));
}

export function validatePackageNameTemplate(template: string): string | null {
  if (!template.trim()) {
    return "Package name template is required.";
  }

  const packageName = renderPackageNameTemplate(template);
  if (!melangePackageNamePattern.test(packageName)) {
    return "Package name template must generate a name that starts with a letter or number and contains only letters, numbers, +, _, ., and -.";
  }

  return null;
}
