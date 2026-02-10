/* tslint:disable */
/* eslint-disable */

export type Null = null;

export function instanceOfNull(value: unknown): value is Null {
  return value === null;
}

export function NullFromJSON(_json: unknown): Null {
  return null;
}

export function NullFromJSONTyped(_json: unknown, _ignoreDiscriminator: boolean): Null {
  return null;
}

export function NullToJSON(_value: Null): null {
  return null;
}

export function NullToJSONTyped(_value: Null | null | undefined, _ignoreDiscriminator: boolean): null {
  return null;
}
