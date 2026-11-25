-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'editor', 'user');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('running', 'success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('crawler', 'manual', 'import', 'api');

-- CreateTable
CREATE TABLE "songs" (
    "id" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "artist" VARCHAR(200) NOT NULL,
    "album" VARCHAR(200),
    "album_cover" VARCHAR(500),
    "audio_url" VARCHAR(500) NOT NULL,
    "audio_url_mp3" VARCHAR(500),
    "lyric_content" TEXT,
    "cover_color" VARCHAR(20),
    "duration" INTEGER,
    "platform" VARCHAR(20),
    "playable" BOOLEAN NOT NULL DEFAULT true,
    "play_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "favorite_count" INTEGER NOT NULL DEFAULT 0,
    "hot_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "url_checked_at" TIMESTAMP(3),
    "crawl_task_id" BIGINT,
    "data_source" "DataSource" NOT NULL DEFAULT 'manual',
    "imported_at" TIMESTAMP(3),
    "imported_by" INTEGER,
    "last_edited_by" INTEGER,
    "source_url" VARCHAR(500),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "archive_reason" VARCHAR(200),
    "file_path" VARCHAR(500),
    "url_source" VARCHAR(20),
    "url_expires_at" TIMESTAMP(3),
    "url_refresh_count" INTEGER NOT NULL DEFAULT 0,
    "url_last_failure" TIMESTAMP(3),
    "url_failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_refresh_logs" (
    "id" BIGSERIAL NOT NULL,
    "song_id" VARCHAR(50) NOT NULL,
    "old_url" TEXT,
    "new_url" TEXT,
    "source" VARCHAR(20) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "response_time" INTEGER NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "url_refresh_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_alerts" (
    "id" BIGSERIAL NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "url_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_error_logs" (
    "id" BIGSERIAL NOT NULL,
    "track_id" VARCHAR(50) NOT NULL,
    "user_id" INTEGER,
    "error_type" VARCHAR(50) NOT NULL,
    "url_source" VARCHAR(20),
    "status_code" INTEGER,
    "user_agent" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "code" VARCHAR(10) NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "icon" VARCHAR(50),

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moods" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "icon" VARCHAR(50),

    CONSTRAINT "moods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decades" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "start_year" INTEGER,
    "end_year" INTEGER,

    CONSTRAINT "decades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 1,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_genres" (
    "song_id" TEXT NOT NULL,
    "genre_id" INTEGER NOT NULL,

    CONSTRAINT "song_genres_pkey" PRIMARY KEY ("song_id","genre_id")
);

-- CreateTable
CREATE TABLE "song_languages" (
    "song_id" TEXT NOT NULL,
    "language_id" INTEGER NOT NULL,

    CONSTRAINT "song_languages_pkey" PRIMARY KEY ("song_id","language_id")
);

-- CreateTable
CREATE TABLE "song_scenes" (
    "song_id" TEXT NOT NULL,
    "scene_id" INTEGER NOT NULL,

    CONSTRAINT "song_scenes_pkey" PRIMARY KEY ("song_id","scene_id")
);

-- CreateTable
CREATE TABLE "song_moods" (
    "song_id" TEXT NOT NULL,
    "mood_id" INTEGER NOT NULL,

    CONSTRAINT "song_moods_pkey" PRIMARY KEY ("song_id","mood_id")
);

-- CreateTable
CREATE TABLE "song_decades" (
    "song_id" TEXT NOT NULL,
    "decade_id" INTEGER NOT NULL,

    CONSTRAINT "song_decades_pkey" PRIMARY KEY ("song_id","decade_id")
);

-- CreateTable
CREATE TABLE "song_tags" (
    "song_id" TEXT NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "song_tags_pkey" PRIMARY KEY ("song_id","tag_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "security_question" VARCHAR(200),
    "security_answer" VARCHAR(255),
    "reset_token" VARCHAR(255),
    "reset_token_expires_at" TIMESTAMP(3),
    "emotion_dna" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "action" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" VARCHAR(50),
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_fields" JSONB,
    "new_values" JSONB,
    "old_values" JSONB,
    "user_agent" TEXT,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_songs" (
    "id" SERIAL NOT NULL,
    "playlist_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_logs" (
    "id" BIGSERIAL NOT NULL,
    "task_type" VARCHAR(50) NOT NULL,
    "platform" VARCHAR(20),
    "status" "CrawlStatus" NOT NULL DEFAULT 'running',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "crawl_source" VARCHAR(100),
    "keyword" VARCHAR(200),
    "target_count" INTEGER,
    "batch_size" INTEGER NOT NULL DEFAULT 10,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crawl_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listening_events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "song_id" TEXT,
    "track_path" VARCHAR(500),
    "track_title" VARCHAR(300),
    "track_artist" VARCHAR(300),
    "event_type" VARCHAR(30) NOT NULL,
    "position_ms" INTEGER,
    "duration_ms" INTEGER,
    "feat_sub_bass" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_bass" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_low_mid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_mid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_high_mid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_presence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_brilliance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_air" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_beat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feat_beat_strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heights_series" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listening_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_features" (
    "song_id" TEXT NOT NULL,
    "subBass" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bass" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowMid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "highMid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "presence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "brilliance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "air" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "energy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "genome_x" DOUBLE PRECISION,
    "genome_y" DOUBLE PRECISION,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "song_features_pkey" PRIMARY KEY ("song_id")
);

-- CreateTable
CREATE TABLE "daily_recommendations" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "reason" VARCHAR(200),
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_feedback" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "feedback" VARCHAR(20) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "track_path" TEXT NOT NULL,
    "song_id" VARCHAR(50),
    "snapshot_json" JSONB NOT NULL,
    "locked_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_dna" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "vector_json" JSONB NOT NULL,
    "cipher_svg" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_dna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "song_id" VARCHAR(50) NOT NULL,
    "comment_type" VARCHAR(10) NOT NULL,
    "timestamp_sec" INTEGER,
    "content" TEXT NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_likes" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "comment_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reports" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "comment_id" BIGINT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_sessions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radio_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_messages" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "role" VARCHAR(10) NOT NULL,
    "content" TEXT NOT NULL,
    "songs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preference_memory" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preference_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "songs_title_idx" ON "songs"("title");

-- CreateIndex
CREATE INDEX "songs_artist_idx" ON "songs"("artist");

-- CreateIndex
CREATE INDEX "songs_platform_idx" ON "songs"("platform");

-- CreateIndex
CREATE INDEX "songs_hot_score_idx" ON "songs"("hot_score");

-- CreateIndex
CREATE INDEX "songs_created_at_idx" ON "songs"("created_at");

-- CreateIndex
CREATE INDEX "songs_data_source_idx" ON "songs"("data_source");

-- CreateIndex
CREATE INDEX "songs_archived_idx" ON "songs"("archived");

-- CreateIndex
CREATE INDEX "ft_album" ON "songs"("album");

-- CreateIndex
CREATE INDEX "ft_artist" ON "songs"("artist");

-- CreateIndex
CREATE INDEX "ft_search" ON "songs"("title", "artist", "album");

-- CreateIndex
CREATE INDEX "ft_title" ON "songs"("title");

-- CreateIndex
CREATE INDEX "idx_playable_hot_score" ON "songs"("playable", "hot_score");

-- CreateIndex
CREATE INDEX "idx_url_expires_at" ON "songs"("url_expires_at");

-- CreateIndex
CREATE INDEX "idx_url_checked_at" ON "songs"("url_checked_at");

-- CreateIndex
CREATE INDEX "idx_playable_url_checked" ON "songs"("playable", "url_checked_at");

-- CreateIndex
CREATE INDEX "url_refresh_logs_song_id_idx" ON "url_refresh_logs"("song_id");

-- CreateIndex
CREATE INDEX "url_refresh_logs_created_at_idx" ON "url_refresh_logs"("created_at");

-- CreateIndex
CREATE INDEX "url_refresh_logs_source_idx" ON "url_refresh_logs"("source");

-- CreateIndex
CREATE INDEX "url_refresh_logs_success_idx" ON "url_refresh_logs"("success");

-- CreateIndex
CREATE INDEX "url_alerts_type_idx" ON "url_alerts"("type");

-- CreateIndex
CREATE INDEX "url_alerts_resolved_idx" ON "url_alerts"("resolved");

-- CreateIndex
CREATE INDEX "url_alerts_created_at_idx" ON "url_alerts"("created_at");

-- CreateIndex
CREATE INDEX "url_alerts_level_idx" ON "url_alerts"("level");

-- CreateIndex
CREATE INDEX "audio_error_logs_track_id_idx" ON "audio_error_logs"("track_id");

-- CreateIndex
CREATE INDEX "audio_error_logs_error_type_idx" ON "audio_error_logs"("error_type");

-- CreateIndex
CREATE INDEX "audio_error_logs_created_at_idx" ON "audio_error_logs"("created_at");

-- CreateIndex
CREATE INDEX "genres_parent_id_fkey" ON "genres"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- CreateIndex
CREATE INDEX "tags_parent_id_fkey" ON "tags"("parent_id");

-- CreateIndex
CREATE INDEX "song_genres_genre_id_fkey" ON "song_genres"("genre_id");

-- CreateIndex
CREATE INDEX "song_languages_language_id_fkey" ON "song_languages"("language_id");

-- CreateIndex
CREATE INDEX "song_scenes_scene_id_fkey" ON "song_scenes"("scene_id");

-- CreateIndex
CREATE INDEX "song_moods_mood_id_fkey" ON "song_moods"("mood_id");

-- CreateIndex
CREATE INDEX "song_decades_decade_id_fkey" ON "song_decades"("decade_id");

-- CreateIndex
CREATE INDEX "song_tags_tag_id_fkey" ON "song_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "operation_logs_target_type_target_id_idx" ON "operation_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "operation_logs_user_id_idx" ON "operation_logs"("user_id");

-- CreateIndex
CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs"("created_at");

-- CreateIndex
CREATE INDEX "playlists_user_id_idx" ON "playlists"("user_id");

-- CreateIndex
CREATE INDEX "playlist_songs_song_id_idx" ON "playlist_songs"("song_id");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_songs_playlist_id_song_id_key" ON "playlist_songs"("playlist_id", "song_id");

-- CreateIndex
CREATE INDEX "crawl_logs_status_idx" ON "crawl_logs"("status");

-- CreateIndex
CREATE INDEX "crawl_logs_started_at_idx" ON "crawl_logs"("started_at");

-- CreateIndex
CREATE INDEX "listening_events_user_id_occurred_at_idx" ON "listening_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "listening_events_song_id_idx" ON "listening_events"("song_id");

-- CreateIndex
CREATE INDEX "listening_events_track_path_idx" ON "listening_events"("track_path");

-- CreateIndex
CREATE INDEX "listening_events_event_type_idx" ON "listening_events"("event_type");

-- CreateIndex
CREATE INDEX "song_features_genome_x_idx" ON "song_features"("genome_x");

-- CreateIndex
CREATE INDEX "song_features_genome_y_idx" ON "song_features"("genome_y");

-- CreateIndex
CREATE INDEX "daily_recommendations_user_id_generated_at_idx" ON "daily_recommendations"("user_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_recommendations_user_id_generated_at_song_id_key" ON "daily_recommendations"("user_id", "generated_at", "song_id");

-- CreateIndex
CREATE INDEX "recommendation_feedback_user_id_created_at_idx" ON "recommendation_feedback"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "capsules_user_id_idx" ON "capsules"("user_id");

-- CreateIndex
CREATE INDEX "capsules_locked_until_idx" ON "capsules"("locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "social_dna_user_id_key" ON "social_dna"("user_id");

-- CreateIndex
CREATE INDEX "comments_song_id_comment_type_created_at_idx" ON "comments"("song_id", "comment_type", "created_at");

-- CreateIndex
CREATE INDEX "comments_song_id_comment_type_like_count_idx" ON "comments"("song_id", "comment_type", "like_count");

-- CreateIndex
CREATE INDEX "comments_song_id_timestamp_sec_idx" ON "comments"("song_id", "timestamp_sec");

-- CreateIndex
CREATE INDEX "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "comment_likes_user_id_comment_id_key" ON "comment_likes"("user_id", "comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "comment_reports_user_id_comment_id_key" ON "comment_reports"("user_id", "comment_id");

-- CreateIndex
CREATE INDEX "radio_sessions_user_id_updated_at_idx" ON "radio_sessions"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "radio_messages_session_id_idx" ON "radio_messages"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preference_memory_user_id_key_key" ON "user_preference_memory"("user_id", "key");

-- AddForeignKey
ALTER TABLE "url_refresh_logs" ADD CONSTRAINT "url_refresh_logs_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genres" ADD CONSTRAINT "genres_parent_id_genre_fkey" FOREIGN KEY ("parent_id") REFERENCES "genres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_tag_fkey" FOREIGN KEY ("parent_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_genres" ADD CONSTRAINT "song_genres_genre_id_genre_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_genres" ADD CONSTRAINT "song_genres_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_languages" ADD CONSTRAINT "song_languages_language_id_lang_fkey" FOREIGN KEY ("language_id") REFERENCES "languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_languages" ADD CONSTRAINT "song_languages_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_scenes" ADD CONSTRAINT "song_scenes_scene_id_scene_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_scenes" ADD CONSTRAINT "song_scenes_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_moods" ADD CONSTRAINT "song_moods_mood_id_mood_fkey" FOREIGN KEY ("mood_id") REFERENCES "moods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_moods" ADD CONSTRAINT "song_moods_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_decades" ADD CONSTRAINT "song_decades_decade_id_decade_fkey" FOREIGN KEY ("decade_id") REFERENCES "decades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_decades" ADD CONSTRAINT "song_decades_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_tags" ADD CONSTRAINT "song_tags_song_id_song_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_tags" ADD CONSTRAINT "song_tags_tag_id_tag_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_songs" ADD CONSTRAINT "playlist_songs_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_songs" ADD CONSTRAINT "playlist_songs_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_features" ADD CONSTRAINT "song_features_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_recommendations" ADD CONSTRAINT "daily_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_recommendations" ADD CONSTRAINT "daily_recommendations_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_dna" ADD CONSTRAINT "social_dna_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_sessions" ADD CONSTRAINT "radio_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_messages" ADD CONSTRAINT "radio_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "radio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preference_memory" ADD CONSTRAINT "user_preference_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

