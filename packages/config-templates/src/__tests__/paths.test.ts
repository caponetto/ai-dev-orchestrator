import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIG_FILENAME,
  GOVERNANCE_FILENAME,
  ROLES_DIR,
  ROLES_FILENAME,
  RUNNERS_FILENAME,
  STATIC_DIR,
  TEMPLATES_DIR,
  WORKFLOWS_DIR,
} from '../paths';

describe('paths', () => {
  describe('STATIC_DIR', () => {
    it('is an absolute path', () => {
      expect(STATIC_DIR).toMatch(/^\//);
    });

    it('points to an existing directory', () => {
      expect(existsSync(STATIC_DIR)).toBe(true);
      expect(statSync(STATIC_DIR).isDirectory()).toBe(true);
    });

    it('ends with /static', () => {
      expect(STATIC_DIR).toMatch(/\/static$/);
    });
  });

  describe('filename constants', () => {
    it('CONFIG_FILENAME is config.yaml', () => {
      expect(CONFIG_FILENAME).toBe('config.yaml');
    });

    it('GOVERNANCE_FILENAME is governance.yaml', () => {
      expect(GOVERNANCE_FILENAME).toBe('governance.yaml');
    });

    it('ROLES_FILENAME is roles.yaml', () => {
      expect(ROLES_FILENAME).toBe('roles.yaml');
    });

    it('RUNNERS_FILENAME is runners.yaml', () => {
      expect(RUNNERS_FILENAME).toBe('runners.yaml');
    });
  });

  describe('directory constants', () => {
    it('ROLES_DIR is roles', () => {
      expect(ROLES_DIR).toBe('roles');
    });

    it('WORKFLOWS_DIR is workflows', () => {
      expect(WORKFLOWS_DIR).toBe('workflows');
    });

    it('TEMPLATES_DIR is templates', () => {
      expect(TEMPLATES_DIR).toBe('templates');
    });
  });

  describe('static files exist', () => {
    it('config.yaml exists in STATIC_DIR', () => {
      expect(existsSync(join(STATIC_DIR, CONFIG_FILENAME))).toBe(true);
    });

    it('governance.yaml exists in STATIC_DIR', () => {
      expect(existsSync(join(STATIC_DIR, GOVERNANCE_FILENAME))).toBe(true);
    });

    it('runners.yaml exists in STATIC_DIR', () => {
      expect(existsSync(join(STATIC_DIR, RUNNERS_FILENAME))).toBe(true);
    });

    it('roles directory exists in STATIC_DIR', () => {
      const rolesPath = join(STATIC_DIR, ROLES_DIR);
      expect(existsSync(rolesPath)).toBe(true);
      expect(statSync(rolesPath).isDirectory()).toBe(true);
    });

    it('workflows directory exists in STATIC_DIR', () => {
      const workflowsPath = join(STATIC_DIR, WORKFLOWS_DIR);
      expect(existsSync(workflowsPath)).toBe(true);
      expect(statSync(workflowsPath).isDirectory()).toBe(true);
    });

    it('templates directory exists in STATIC_DIR', () => {
      const templatesPath = join(STATIC_DIR, TEMPLATES_DIR);
      expect(existsSync(templatesPath)).toBe(true);
      expect(statSync(templatesPath).isDirectory()).toBe(true);
    });
  });
});
