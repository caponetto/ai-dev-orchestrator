import type { ValidationReport } from '@ai-dev-orchestrator/ports';

import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { validateProjectConfig } from '../project-config';

export interface ValidateOptions {
  readonly json: boolean;
  readonly verbose: boolean;
}

export function emitJsonValidation(report: ValidationReport): void {
  process.stdout.write(
    JSON.stringify({
      valid: report.valid,
      errors: report.errors,
      warnings: report.warnings,
    }) + '\n',
  );
}

export function emitFormattedValidation(
  report: ValidationReport,
  options: ValidateOptions,
  formatter: OutputFormatter,
): void {
  if (report.valid) {
    formatter.success('Configuration is valid.');
  }

  if (report.errors.length > 0) {
    for (const issue of report.errors) {
      formatter.error({
        code: ExitCode.CONFIGURATION_ERROR,
        message: `${issue.path}: ${issue.message}`,
        remediation: issue.remediation,
        detail: issue.file,
      });
    }
  }

  if (options.verbose && report.warnings.length > 0) {
    formatter.section('Warnings');
    for (const issue of report.warnings) {
      formatter.info(`${issue.path}: ${issue.message}`);
    }
  }
}

export function validateCommand(options: ValidateOptions, formatter: OutputFormatter): ExitCode {
  let report: ValidationReport;
  try {
    report = validateProjectConfig();
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  if (options.json) {
    emitJsonValidation(report);
  } else {
    emitFormattedValidation(report, options, formatter);
  }

  return report.valid ? ExitCode.SUCCESS : ExitCode.CONFIGURATION_ERROR;
}
