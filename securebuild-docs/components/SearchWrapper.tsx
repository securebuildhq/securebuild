'use client'

import { Search } from 'nextra/components'

// Wrapper component to handle React 19 ref compatibility with Nextra's Search
// The Search component from nextra/components may pass refs that end up on
// React.Fragment in certain scenarios with React 19
export function SearchWrapper() {
  return (
    <div className="nextra-search">
      <Search />
    </div>
  )
}
