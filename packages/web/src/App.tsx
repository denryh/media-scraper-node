import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { useDebounced } from './lib/useDebounced';
import { AppShell } from './components/AppShell';
import { SubmitForm } from './components/SubmitForm';
import { Filters, type MediaType } from './components/Filters';
import { MediaGrid } from './components/MediaGrid';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <Page />
      </AppShell>
    </QueryClientProvider>
  );
}

function Page() {
  const [type, setType] = useState<MediaType>('all');
  const [searchInput, setSearchInput] = useState('');
  const q = useDebounced(searchInput.trim(), 300);

  return (
    <>
      <SubmitForm />
      <Filters
        type={type}
        onType={setType}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
      />
      <MediaGrid type={type === 'all' ? undefined : type} q={q} />
    </>
  );
}
