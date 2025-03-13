import type { FlatPath, GenericForm } from "../../../@types/types-core"

export const useFormValue = <Form extends GenericForm>(_form: Form) => {
  return {
    getValue,
  }
}

function getValue<Form extends GenericForm>(): Form
function getValue<Form extends GenericForm, Path extends FlatPath<Form>>(
  path: Path,
): Form
function getValue() {}
