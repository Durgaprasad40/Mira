/**
 * Onboarding Validation Helper
 * Provides reusable validation pattern for onboarding screens.
 */

import { RefObject } from 'react';
import { ScrollView, TextInput } from 'react-native';

/**
 * Validation rule function - returns error message if invalid, undefined if valid
 */
export type ValidationRule<T = any> = (value: T) => string | undefined;

/**
 * Field rules configuration
 */
export type FieldRules<T extends Record<string, any>> = {
  [K in keyof T]?: ValidationRule<T[K]>;
};

/**
 * Validation result
 */
export interface ValidationResult<T extends Record<string, any>> {
  ok: boolean;
  firstInvalidKey?: keyof T;
  errors: Partial<Record<keyof T, string>>;
}

/**
 * Validate fields against rules
 * @param fields - Object containing field values
 * @param rules - Object containing validation rules for each field
 * @returns ValidationResult with ok status, first invalid key, and all errors
 */
export function validateRequired<T extends Record<string, any>>(
  fields: T,
  rules: FieldRules<T>
): ValidationResult<T> {
  const errors: Partial<Record<keyof T, string>> = {};
  let firstInvalidKey: keyof T | undefined;

  // Iterate in rule order to find first invalid
  for (const key of Object.keys(rules) as (keyof T)[]) {
    const rule = rules[key];
    if (rule) {
      const error = rule(fields[key]);
      if (error) {
        errors[key] = error;
        if (firstInvalidKey === undefined) {
          firstInvalidKey = key;
        }
      }
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    firstInvalidKey,
    errors,
  };
}

/**
 * Scroll to and focus the first invalid field
 * @param scrollRef - Ref to ScrollView
 * @param fieldRefs - Map of field keys to their refs (TextInput or View with measureLayout)
 * @param firstInvalidKey - Key of the first invalid field
 * @param offsetY - Optional offset from top (default: 100)
 */
export function scrollToFirstInvalid<T extends string>(
  scrollRef: RefObject<ScrollView | null>,
  fieldRefs: Partial<Record<T, RefObject<any>>>,
  firstInvalidKey: T | undefined,
  offsetY: number = 100
): void {
  if (!firstInvalidKey || !scrollRef.current) return;

  const fieldRef = fieldRefs[firstInvalidKey];
  if (!fieldRef?.current) return;

  // Try to focus if it's a TextInput
  if (typeof fieldRef.current.focus === 'function') {
    try {
      fieldRef.current.focus();
    } catch {
      // Focus failed silently - not a critical error
    }
  }

  // Try to scroll to the field
  try {
    // SAFETY: Check if measureLayout is available on the ref
    if (typeof fieldRef.current.measureLayout !== 'function') {
      // Ref doesn't support measureLayout - scroll to top as fallback
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    // SAFETY: Check if getInnerViewNode is available and returns a valid node
    if (typeof scrollRef.current.getInnerViewNode !== 'function') {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const innerViewNode = scrollRef.current.getInnerViewNode();
    if (!innerViewNode) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    fieldRef.current.measureLayout(
      innerViewNode,
      (_x: number, y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - offsetY), animated: true });
      },
      () => {
        // measureLayout failed, try scrollTo 0 as fallback
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    );
  } catch {
    // Fallback: scroll to top
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }
}

/**
 * Common validation rules factory
 */
export const createRules = {
  /** Required string with minimum length */
  minLength: (min: number, fieldName: string = 'This field'): ValidationRule<string> =>
    (value) => {
      if (!value || value.trim().length < min) {
        return `${fieldName} must be at least ${min} characters`;
      }
      return undefined;
    },

  /** Required string with maximum length */
  maxLength: (max: number, fieldName: string = 'This field'): ValidationRule<string> =>
    (value) => {
      if (value && value.length > max) {
        return `${fieldName} must be no more than ${max} characters`;
      }
      return undefined;
    },

  /** Required non-empty value */
  required: (fieldName: string = 'This field'): ValidationRule<any> =>
    (value) => {
      if (value === null || value === undefined || value === '' ||
          (Array.isArray(value) && value.length === 0)) {
        return `${fieldName} is required`;
      }
      return undefined;
    },

  /** Combine multiple rules - returns first error found */
  combine: <T>(...rules: ValidationRule<T>[]): ValidationRule<T> =>
    (value) => {
      for (const rule of rules) {
        const error = rule(value);
        if (error) return error;
      }
      return undefined;
    },
};
