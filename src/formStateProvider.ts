import * as React from 'react';
import * as PropTypes from 'prop-types';
import { Map } from 'immutable';

import { isDefinedName } from './definitionChecker';
import { changeAdaptor, focusAdaptor } from './eventAdaptors';
import { invokeHandler, mergeErrors } from './handlerEngine';
import { FormErrors, ProviderProps, Inspector } from './types';

/**
 * FormStateProvider(=return of {formStateProvider<P>}) supplies all this properties.
 */
export type FormProps<P> = {
    formValues: P,
    formErrors: FormErrors<P>,
    formIsSubmitting: boolean,
    formIsPristine: boolean,
    formHasError: boolean,
    formChange: (name: keyof P, value: any, validate?: boolean) => void,
    formValidate: (name: keyof P) => void,
    formSubmit: (event?: React.FormEvent<any>) => void,
    formReset: () => void,
};

export type FormComponent<P> = React.ComponentType<Partial<FormProps<P>>>;
export type ProviderComponent<P> = React.ComponentClass<ProviderProps<P>>;

/**
 * This HOC enhances your form component.
 * @param {FormComponent<P>} Form target component of manage. Wrapped component provides {FormProps<P>} properties.
 * @return {ProviderComponent<P>} FormStateProvider, a managed component which has {ProviderProps<P>} properties.
 */
export function formStateProvider<P>(Form: FormComponent<P>): ProviderComponent<P> {
    type ProviderState = {
        values: P,
        errors: FormErrors<P>,
        isSubmitting: boolean,
    };

    return class FormStateProvider extends React.Component<ProviderProps<P>, ProviderState> {
        // runtime properties check for Redux or/and ECMA applications.
        static propTypes = {
            defaultValues: PropTypes.object.isRequired,
            submitter: PropTypes.func.isRequired,
            validators: PropTypes.objectOf(PropTypes.func),
            inspector: PropTypes.func,
        };

        constructor(props: ProviderProps<P>) {
            super(props);
            const values = props.defaultValues != null ? props.defaultValues : {} as P;
            this.state = { values, errors: {}, isSubmitting: false };
            this.change = this.change.bind(this);
            this.validate = this.validate.bind(this);
            this.submit = this.submit.bind(this);
            this.reset = this.reset.bind(this);
            this.notify = props.inspector != null ? props.inspector : () => {};
        }

        private canSetStateFromAsync: boolean = false;
        private notify: Inspector;

        componentWillMount() {
            this.canSetStateFromAsync = true;
            this.notify('mount', 'form');
        }

        componentWillUnmount() {
            this.notify('unmount', 'form');
            this.canSetStateFromAsync = false;
        }

        private isPristine(): boolean {
            for (const name of Object.keys(this.state.values)) {
                if (this.state.values[name as keyof P] !== this.props.defaultValues[name as keyof P]) {
                    return false;
                }
            }
            return true;
        }

        private hasError(): boolean {
            for (const name of Object.keys(this.state.errors)) {
                if (this.state.errors[name as keyof P] != null) {
                    return true;
                }
            }
            return false;
        }

        private updateErrors(name: keyof P | 'form', newErrors: any) {
            if (this.canSetStateFromAsync) {
                const errors = mergeErrors<P>(this.props.defaultValues, this.state.errors, name, newErrors);
                this.setState({ errors });
            }
        }

        private invokeValidator(name: keyof P, newValue: any) {
            if (this.props.validators == null) {
                return;
            }
            const validator = this.props.validators[name];
            if (validator == null) {
                return;
            }
            const currentValues = Map(this.state.values).set(name, newValue).toJS();
            invokeHandler<P>(
                name,
                () => validator(currentValues, name, this.notify),
                () => this.updateErrors(name, null),
                reason => this.updateErrors(name, reason),
                this.notify,
            );
        }

        private change(name: keyof P, newValue: any, validateConcurrently: boolean = true) {
            if (isDefinedName<P>(this.props.defaultValues, name, 'props.formChange')) {
                this.setState(Map({}).set('values', Map(this.state.values).set(name, newValue)).toJS());
                this.notify('props.formChange', name, newValue);
                if (validateConcurrently) {
                    this.invokeValidator(name, newValue);
                }
            }
        }

        private validate(name: keyof P) {
            if (isDefinedName<P>(this.props.defaultValues, name, 'props.formValidate')) {
                this.invokeValidator(name, this.state.values[name]);
                this.notify('props.formValidate', name);
            }
        }

        private endSubmitting() {
            if (this.canSetStateFromAsync) {
                this.setState({ isSubmitting: false });
            }
        }

        private submit(event?: React.FormEvent<any>) {
            if (event != null && event.preventDefault != null) {
                event.preventDefault();
            }
            this.setState({ isSubmitting: true });
            this.notify('form', 'props.formSubmit');
            invokeHandler<P>(
                'form',
                () => {
                    const values = Map(this.state.values).toJS();
                    return this.props.submitter(values, 'form', this.notify);
                },
                () => {
                    this.updateErrors('form', null);
                    this.endSubmitting();
                },
                (reason) => {
                    this.updateErrors('form', reason);
                    this.endSubmitting();
                },
                this.notify,
            );
        }

        private reset() {
            if (this.canSetStateFromAsync) {
                this.setState({ values: this.props.defaultValues, errors: {}, isSubmitting: false });
                this.notify('props.formReset', 'form');
            }
        }

        render () {
            const Component = Form as React.ComponentClass<FormProps<P>>;
            const props = Map<string, any>(this.props)
                .delete('defaultValues').delete('submitter').delete('validators').delete('inspector')
                .merge({
                    formValues: this.state.values,
                    formErrors: this.state.errors,
                    formIsSubmitting: this.state.isSubmitting,
                    formIsPristine: this.isPristine(),
                    formHasError: this.hasError(),
                    formChange: this.change,
                    formValidate: this.validate,
                    formSubmit: this.submit,
                    formReset: this.reset,
                    // FormPropsEx
                    formOnChange: changeAdaptor(this.change),
                    formOnValidate: focusAdaptor(this.validate),
                }).toJS();
            return React.createElement<FormProps<P>>(Component, props);
        }
    };
}
