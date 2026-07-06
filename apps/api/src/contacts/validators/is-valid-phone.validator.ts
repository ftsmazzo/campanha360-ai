import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidPhone } from '../../common/phone.util';

@ValidatorConstraint({ name: 'isValidPhone', async: false })
export class IsValidPhoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value === undefined || value === null || value === '') return true;
    if (typeof value !== 'string') return false;
    return isValidPhone(value);
  }

  defaultMessage() {
    return 'Telefone invalido';
  }
}

export function IsValidPhone(validationOptions?: ValidationOptions) {
  return function register(object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidPhoneConstraint,
    });
  };
}
