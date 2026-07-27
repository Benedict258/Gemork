const CREDENTIAL_PATTERNS = {
  password: {
    typeAttrs: ['password'],
    autocompletePatterns: ['current-password', 'new-password'],
    namePatterns: [],
    idPatterns: [],
    placeholderPatterns: [],
    ariaLabelPatterns: [],
  },
  'credit-card': {
    typeAttrs: [],
    autocompletePatterns: [
      'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
      'cc-csc', 'cc-name', 'cc-type',
    ],
    namePatterns: ['card', 'credit', 'cc-', 'payment'],
    idPatterns: ['card', 'credit', 'cc-', 'payment'],
    placeholderPatterns: ['card number', 'credit card', 'ccv', 'cvv', 'cvc'],
    ariaLabelPatterns: ['card number', 'credit card', 'expiry', 'security code'],
  },
  ssn: {
    typeAttrs: [],
    autocompletePatterns: [],
    namePatterns: ['ssn', 'social-security', 'social_security', 'socialsecurity'],
    idPatterns: ['ssn', 'social-security', 'social_security', 'socialsecurity'],
    placeholderPatterns: ['ssn', 'social security', 'xxx-xx-xxxx'],
    ariaLabelPatterns: ['social security', 'ssn'],
  },
  bank: {
    typeAttrs: [],
    autocompletePatterns: ['transaction-amount'],
    namePatterns: ['account-number', 'account_number', 'routing-number', 'routing_number', 'bank-account', 'bank_account', 'account-number', 'routing'],
    idPatterns: ['account-number', 'account_number', 'routing-number', 'routing_number', 'bank-account', 'bank_account'],
    placeholderPatterns: ['account number', 'routing number', 'bank account'],
    ariaLabelPatterns: ['account number', 'routing number', 'bank account'],
  },
  'api-key': {
    typeAttrs: [],
    autocompletePatterns: [],
    namePatterns: ['api-key', 'api_key', 'apikey', 'secret', 'token', 'access-token', 'access_token', 'private-key', 'private_key'],
    idPatterns: ['api-key', 'api_key', 'apikey', 'secret', 'token', 'access-token', 'access_token', 'private-key', 'private_key'],
    placeholderPatterns: ['api key', 'secret', 'token', 'access token', 'private key'],
    ariaLabelPatterns: ['api key', 'secret', 'token', 'access token', 'private key'],
  },
};

function getAttributeText(element, attr) {
  return (element.getAttribute(attr) || '').toLowerCase().trim();
}

function matchesPatterns(text, patterns) {
  return patterns.some(p => text.includes(p));
}

function detectByType(element) {
  const type = (element.getAttribute('type') || '').toLowerCase();
  if (CREDENTIAL_PATTERNS.password.typeAttrs.includes(type)) {
    return 'password';
  }
  return null;
}

function detectByAutocomplete(element) {
  const ac = getAttributeText(element, 'autocomplete');
  if (!ac) return null;

  for (const [credType, patterns] of Object.entries(CREDENTIAL_PATTERNS)) {
    if (matchesPatterns(ac, patterns.autocompletePatterns)) {
      return credType;
    }
  }
  return null;
}

function detectByNameOrId(element) {
  const name = getAttributeText(element, 'name');
  const id = getAttributeText(element, 'id');
  const combined = `${name} ${id}`;

  for (const [credType, patterns] of Object.entries(CREDENTIAL_PATTERNS)) {
    if (matchesPatterns(combined, [...patterns.namePatterns, ...patterns.idPatterns])) {
      return credType;
    }
  }
  return null;
}

function detectByPlaceholderOrAria(element) {
  const placeholder = getAttributeText(element, 'placeholder');
  const ariaLabel = getAttributeText(element, 'aria-label');
  const combined = `${placeholder} ${ariaLabel}`;

  for (const [credType, patterns] of Object.entries(CREDENTIAL_PATTERNS)) {
    if (matchesPatterns(combined, [...patterns.placeholderPatterns, ...patterns.ariaLabelPatterns])) {
      return credType;
    }
  }
  return null;
}

function detectByDataAttributes(element) {
  const dataSensitive = element.getAttribute('data-sensitive');
  const dataCredential = element.getAttribute('data-credential-type');
  if (dataCredential) return dataCredential;
  if (dataSensitive === 'true' || dataSensitive === '') return 'password';
  return null;
}

function getCredentialType(element) {
  if (!(element instanceof Element)) return null;

  return (
    detectByDataAttributes(element) ||
    detectByType(element) ||
    detectByAutocomplete(element) ||
    detectByNameOrId(element) ||
    detectByPlaceholderOrAria(element) ||
    null
  );
}

function isCredentialField(element) {
  return getCredentialType(element) !== null;
}

function scanPageForCredentials() {
  const selectors = 'input, textarea, select, [contenteditable]';
  const elements = document.querySelectorAll(selectors);
  const results = [];

  for (const el of elements) {
    const credType = getCredentialType(el);
    if (credType) {
      const rect = el.getBoundingClientRect();
      results.push({
        element: el,
        type: credType,
        tag: el.tagName.toLowerCase(),
        inputType: el.getAttribute('type') || null,
        name: el.getAttribute('name') || null,
        id: el.id || null,
        autocomplete: el.getAttribute('autocomplete') || null,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    }
  }

  return results;
}

if (typeof window !== 'undefined') {
  window.GemorkCredentialDetector = {
    isCredentialField,
    getCredentialType,
    scanPageForCredentials,
  };
}

export { isCredentialField, getCredentialType, scanPageForCredentials };
