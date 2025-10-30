import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './MovieDiscussion.css';

const MovieDiscussion = ({
  canComment = false,
  commentDraft = '',
  onCommentChange,
  onSubmitComment,
  onClearComment,
  onDeleteComment,
  onEditComment,
  commentPending = false,
  commentError = null,
  friendComments = [],
  hasSavedComment = false,
  isEditingComment = false,
}) => {
  const textAreaRef = useRef(null);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (commentPending || !onSubmitComment) {
      return;
    }
    onSubmitComment();
  };

  const hasFriendComments = Array.isArray(friendComments) && friendComments.length > 0;

  useEffect(() => {
    const element = textAreaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [commentDraft, hasSavedComment, isEditingComment]);

  const showFormActions = !hasSavedComment || isEditingComment;
  const showReadOnlyActions = hasSavedComment && canComment && !isEditingComment;

  return (
    <section className="movie-discussion" aria-labelledby="movie-discussion-title">
      <div className="movie-discussion__header">
        <div>
          <h2 id="movie-discussion-title">Share Your Thoughts</h2>
          <p className="movie-discussion__tagline">
            Leave a quick note for your friends and check out what they said.
          </p>
        </div>
      </div>

      <div className="movie-discussion__content">
        <form className="movie-discussion__form" onSubmit={handleSubmit}>
          <label htmlFor="movie-discussion-textarea" className="movie-discussion__label">
            Your comment
          </label>
          <textarea
            id="movie-discussion-textarea"
            className="movie-discussion__textarea"
            ref={textAreaRef}
            value={commentDraft}
            onChange={(event) => onCommentChange && onCommentChange(event.target.value)}
            placeholder={
              canComment
                ? 'What stood out for you? Keep it short and sweet.'
                : 'Sign in to add your comment.'
            }
            maxLength={2000}
            disabled={!canComment || commentPending || (hasSavedComment && !isEditingComment)}
          />

          {showFormActions ? (
            <div className="movie-discussion__actions">
              <button
                type="submit"
                className="movie-discussion__submit"
                disabled={!canComment || commentPending}
              >
                {commentPending
                  ? 'Saving…'
                  : hasSavedComment
                  ? 'Update comment'
                  : 'Save comment'}
              </button>
              <button
                type="button"
                className="movie-discussion__clear"
                onClick={() => onClearComment && onClearComment()}
                disabled={!canComment || commentPending || !commentDraft.trim()}
              >
                Clear
              </button>
            </div>
          ) : null}

          {showReadOnlyActions ? (
            <div className="movie-discussion__readonly-actions">
              <button
                type="button"
                className="movie-discussion__edit"
                onClick={() => onEditComment && onEditComment()}
                disabled={commentPending}
              >
                Edit comment
              </button>
              <button
                type="button"
                className="movie-discussion__delete"
                onClick={() => onDeleteComment && onDeleteComment()}
                disabled={commentPending}
              >
                Delete comment
              </button>
            </div>
          ) : null}

          {commentError ? (
            <p className="movie-discussion__error" role="alert">
              {commentError}
            </p>
          ) : null}
          {!canComment ? (
            <p className="movie-discussion__hint">
              Comments stay in sync with your profile when you are signed in.
            </p>
          ) : null}
        </form>

        <div className="movie-discussion__friends">
          <h3>Friends are saying</h3>
          {hasFriendComments ? (
            <ul className="movie-discussion__friend-list">
              {friendComments.map((entry) => (
                <li key={entry.id} className="movie-discussion__friend-item">
                  <div className="movie-discussion__friend-meta">
                    <span className="movie-discussion__friend-name">{entry.name}</span>
                    {entry.updatedAt ? (
                      <span className="movie-discussion__friend-date">
                        {entry.updatedAt}
                      </span>
                    ) : null}
                  </div>
                  <p className="movie-discussion__friend-text">{entry.comment}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="movie-discussion__empty">
              {canComment
                ? 'Your friends have not left a comment yet.'
                : 'Sign in to see comments from your friends.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

MovieDiscussion.propTypes = {
  canComment: PropTypes.bool,
  commentDraft: PropTypes.string,
  onCommentChange: PropTypes.func,
  onSubmitComment: PropTypes.func,
  onClearComment: PropTypes.func,
  onDeleteComment: PropTypes.func,
  onEditComment: PropTypes.func,
  commentPending: PropTypes.bool,
  commentError: PropTypes.string,
  friendComments: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      comment: PropTypes.string,
      updatedAt: PropTypes.string,
    }),
  ),
  hasSavedComment: PropTypes.bool,
  isEditingComment: PropTypes.bool,
};

MovieDiscussion.defaultProps = {
  canComment: false,
  commentDraft: '',
  onCommentChange: null,
  onSubmitComment: null,
  onClearComment: null,
  onDeleteComment: null,
  onEditComment: null,
  commentPending: false,
  commentError: null,
  friendComments: [],
  hasSavedComment: false,
  isEditingComment: false,
};

export default MovieDiscussion;