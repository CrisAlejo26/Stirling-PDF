export function useRequestHeaders(): HeadersInit {
  const token = localStorage.getItem('pdfox_jwt');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}
