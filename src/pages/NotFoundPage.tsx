import { useNavigate } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="app-container dark">
      <div className="not-found-page">
        <div className="nf-icon">404</div>
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <button className="cta-button" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    </div>
  );
};
