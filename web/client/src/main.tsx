import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import ExperienceListPage from './pages/ExperienceListPage'
import ExperienceDetailPage from './pages/ExperienceDetailPage'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ExperienceListPage />} />
        <Route path="/experiences/:id" element={<ExperienceDetailPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
