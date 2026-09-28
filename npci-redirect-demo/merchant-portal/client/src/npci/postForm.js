// Top-level browser navigation via a hidden form POST. This is how the portal
// hands the customer over to NPCI (and how NPCI hands them back to us): fetch()
// cannot be used because the user's browser has to actually navigate.
export function postForm(action, fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
