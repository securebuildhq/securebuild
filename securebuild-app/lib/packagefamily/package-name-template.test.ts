import {
  renderPackageNameTemplate,
  validatePackageNameTemplate,
} from "./package-name-template";

describe("package name templates", () => {
  test("renders supported placeholders", () => {
    expect(renderPackageNameTemplate("{name}-{major}.{minor}", "go", 1, 24))
      .toBe("go-1.24");
  });

  test.each([
    "{name}-{major}.{minor}",
    "lib{name}_{major}+compat",
    "package",
  ])("accepts template %s when it generates a valid Melange package name", (template) => {
    expect(validatePackageNameTemplate(template)).toBeNull();
  });

  test.each([
    "",
    "   ",
    "-{name}",
    "{name}/{major}",
    "{name}-{version}",
    "{name} [debug]",
  ])("rejects template %s when it cannot generate a valid Melange package name", (template) => {
    expect(validatePackageNameTemplate(template)).not.toBeNull();
  });
});
