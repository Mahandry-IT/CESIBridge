const TLS_PATTERN = /certificate|UNABLE_TO_VERIFY|SELF_SIGNED|CERT_/i;

/** Erreur de vérification TLS (chaîne de certificats incomplète, proxy d'inspection…). */
export function isTlsError(error) {
  return [error?.message, error?.code, error?.cause?.message, error?.cause?.code].some(
    (value) => typeof value === 'string' && TLS_PATTERN.test(value),
  );
}

/** Message sûr pour une erreur réseau : jamais le message brut (il peut contenir l'URL). */
export function describeNetworkError(error, service) {
  if (error?.name === 'TimeoutError') return `${service} : délai dépassé`;
  if (isTlsError(error)) {
    return `${service} : certificat TLS non vérifiable par Node (définir NODE_EXTRA_CA_CERTS, voir README)`;
  }
  return `${service} injoignable`;
}
