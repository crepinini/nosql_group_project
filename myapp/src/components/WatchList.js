import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getStoredUser, subscribeToAuthChanges } from './Login/auth';

const WatchList = () => {
    const [authUser, setAuthUser] = useState(() => getStoredUser());

    useEffect(() => {
        const unsubscribe = subscribeToAuthChanges(() => {
            setAuthUser(getStoredUser());
        });
        return () => {
            unsubscribe();
        };
    }, []);

    if (!authUser) {
    return <Navigate to="/login" replace />;
    }
    return (
    <div className="watchlist-page">
      <h1>My WatchList</h1>
    </div>
    );
};
export default WatchList;