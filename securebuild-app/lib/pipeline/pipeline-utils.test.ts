import { sanitizePipelinePath, validatePipelinePath, extractPipelineNameFromYAML, isValidInputName, validatePipelineInputNames } from './pipeline-utils';
import { ValidationError } from '@/lib/errors/validation-error';

describe('pipeline-utils', () => {
  describe('sanitizePipelinePath', () => {
    it('should accept valid paths', () => {
      // Paths with category
      expect(sanitizePipelinePath('test/smoke-binary')).toBe('test/smoke-binary');
      expect(sanitizePipelinePath('test_pipeline/my-test')).toBe('test_pipeline/my-test');

      // Paths without category (like melange's built-in pipelines)
      expect(sanitizePipelinePath('fetch')).toBe('fetch');
      expect(sanitizePipelinePath('strip')).toBe('strip');
    });

    it('should accept deeply nested paths', () => {
      expect(sanitizePipelinePath('test/integration/smoke/binary')).toBe('test/integration/smoke/binary');
    });

    it('should reject invalid paths', () => {
      // Invalid characters
      expect(sanitizePipelinePath('test/../traversal')).toBeNull();
      expect(sanitizePipelinePath('test/./current')).toBeNull();
      expect(sanitizePipelinePath('test\\backslash')).toBeNull();
      expect(sanitizePipelinePath('test/with spaces')).toBeNull();
      expect(sanitizePipelinePath('test/with@special')).toBeNull();
      expect(sanitizePipelinePath('../outside')).toBeNull();

      // Absolute paths
      expect(sanitizePipelinePath('/absolute/path')).toBeNull();

      // Empty components
      expect(sanitizePipelinePath('')).toBeNull();
      expect(sanitizePipelinePath('/')).toBeNull();
      expect(sanitizePipelinePath('test/')).toBeNull();
      expect(sanitizePipelinePath('/test')).toBeNull();
      expect(sanitizePipelinePath('test//double')).toBeNull();
    });

    it('should trim whitespace', () => {
      expect(sanitizePipelinePath('  test/pipeline  ')).toBe('test/pipeline');
    });

    it('should accept reasonable path lengths', () => {
      const longCategory = 'a'.repeat(100);
      const longName = 'b'.repeat(100);
      const longPath = `${longCategory}/${longName}`;
      expect(sanitizePipelinePath(longPath)).toBe(longPath);
    });
  });

  describe('validatePipelinePath', () => {
    it('should throw ValidationError for invalid paths', () => {
      expect(() => validatePipelinePath('test/../traversal')).toThrow(ValidationError);
      expect(() => validatePipelinePath('')).toThrow(ValidationError);
      expect(() => validatePipelinePath('/absolute/path')).toThrow(ValidationError);
    });
  });

  describe('extractPipelineNameFromYAML', () => {
    it('should extract name from valid YAML', () => {
      const yaml = 'name: test-pipeline\npipeline:\n  - runs: echo "test"';
      expect(extractPipelineNameFromYAML(yaml)).toBe('test-pipeline');
    });

    it('should return null for YAML without name', () => {
      const yaml = 'pipeline:\n  - runs: echo "test"';
      expect(extractPipelineNameFromYAML(yaml)).toBeNull();
    });

    it('should return null for invalid YAML', () => {
      const yaml = 'invalid: yaml: content: [';
      expect(extractPipelineNameFromYAML(yaml)).toBeNull();
    });

    it('should return null for non-object YAML', () => {
      const yaml = 'just a string';
      expect(extractPipelineNameFromYAML(yaml)).toBeNull();
    });
  });

  describe('isValidInputName', () => {
    it('should accept valid input names', () => {
      // Simple name
      expect(isValidInputName('message')).toBe(true);

      // Names with underscores
      expect(isValidInputName('my_input')).toBe(true);

      // Names with numbers
      expect(isValidInputName('input1')).toBe(true);
      expect(isValidInputName('value123')).toBe(true);
      expect(isValidInputName('param2_test')).toBe(true);

      // Uppercase names
      expect(isValidInputName('MESSAGE')).toBe(true);
      expect(isValidInputName('MyInput')).toBe(true);
      expect(isValidInputName('camelCase')).toBe(true);
      expect(isValidInputName('SNAKE_case12345')).toBe(true);
    });

    it('should reject invalid input names', () => {
      // Empty name
      expect(isValidInputName('')).toBe(false);

      // Names starting with numbers
      expect(isValidInputName('1input')).toBe(false);
      expect(isValidInputName('123')).toBe(false);

      // Names with hyphens (Go templates treat as subtraction)
      expect(isValidInputName('kebab-case')).toBe(false);

      // Names with special characters
      expect(isValidInputName('input@name')).toBe(false);
      expect(isValidInputName('input.name')).toBe(false);
      expect(isValidInputName('input name')).toBe(false);
      expect(isValidInputName('input$value')).toBe(false);

      // Names starting with underscore
      expect(isValidInputName('_input')).toBe(false);
      expect(isValidInputName('__private')).toBe(false);
    });
  });

  describe('validatePipelineInputNames', () => {
    it('should pass for valid pipeline YAML with valid inputs', () => {
      const yaml = `name: test-pipeline
inputs:
  message:
    description: A test message
    required: true
  count:
    description: Number of times
    default: "3"
  my_value:
    description: Underscore value
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });

    it('should pass for pipeline YAML without inputs', () => {
      const yaml = `name: test-pipeline
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });

    it('should pass for empty inputs object', () => {
      const yaml = `name: test-pipeline
inputs: {}
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });

    it('should throw ValidationError for hyphenated input names', () => {
      const yaml = `name: test-pipeline
inputs:
  my-input:
    description: Input with hyphen
    required: true
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).toThrow(ValidationError);
      expect(() => validatePipelineInputNames(yaml)).toThrow(/my-input/);
      expect(() => validatePipelineInputNames(yaml)).toThrow(/no hyphens/);
    });

    it('should throw ValidationError for input names starting with numbers', () => {
      const yaml = `name: test-pipeline
inputs:
  1input:
    description: Input starting with number
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).toThrow(ValidationError);
      expect(() => validatePipelineInputNames(yaml)).toThrow(/1input/);
    });

    it('should list all invalid input names in error', () => {
      const yaml = `name: test-pipeline
inputs:
  my-input:
    description: First invalid
  another-input:
    description: Second invalid
  valid_input:
    description: This one is valid
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).toThrow(ValidationError);
      expect(() => validatePipelineInputNames(yaml)).toThrow(/my-input/);
      expect(() => validatePipelineInputNames(yaml)).toThrow(/another-input/);
    });

    it('should not throw for invalid YAML (let backend handle)', () => {
      const yaml = 'invalid: yaml: [content';

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });

    it('should not throw for non-object YAML', () => {
      const yaml = 'just a string';

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });

    it('should not throw when inputs is not an object', () => {
      const yaml = `name: test-pipeline
inputs: "not an object"
pipeline:
  - runs: echo "test"`;

      expect(() => validatePipelineInputNames(yaml)).not.toThrow();
    });
  });
});
