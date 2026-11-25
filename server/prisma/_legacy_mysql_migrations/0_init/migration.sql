-- CreateTable
CREATE TABLE `songs` (
    `id` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `artist` VARCHAR(200) NOT NULL,
    `album` VARCHAR(200) NULL,
    `album_cover` VARCHAR(500) NULL,
    `audio_url` VARCHAR(500) NOT NULL,
    `audio_url_mp3` VARCHAR(500) NULL,
    `lyric_content` TEXT NULL,
    `cover_color` VARCHAR(20) NULL,
    `platform` VARCHAR(20) NULL,
    `playable` BOOLEAN NOT NULL DEFAULT true,
    `play_count` INTEGER NOT NULL DEFAULT 0,
    `comment_count` INTEGER NOT NULL DEFAULT 0,
    `like_count` INTEGER NOT NULL DEFAULT 0,
    `favorite_count` INTEGER NOT NULL DEFAULT 0,
    `hot_score` DOUBLE NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `url_checked_at` DATETIME(3) NULL,
    `data_source` ENUM('crawler', 'manual', 'import', 'api') NOT NULL DEFAULT 'manual',
    `source_url` VARCHAR(500) NULL,
    `imported_by` INTEGER NULL,
    `imported_at` DATETIME(3) NULL,
    `last_edited_by` INTEGER NULL,
    `crawl_task_id` BIGINT NULL,

    INDEX `songs_title_idx`(`title`),
    INDEX `songs_artist_idx`(`artist`),
    INDEX `songs_platform_idx`(`platform`),
    INDEX `songs_hot_score_idx`(`hot_score`),
    INDEX `songs_created_at_idx`(`created_at`),
    INDEX `songs_data_source_idx`(`data_source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `genres` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `parent_id` INTEGER NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `languages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `code` VARCHAR(10) NOT NULL,

    UNIQUE INDEX `languages_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scenes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `icon` VARCHAR(50) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moods` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `icon` VARCHAR(50) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(20) NOT NULL,
    `start_year` INTEGER NULL,
    `end_year` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `parent_id` INTEGER NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_genres` (
    `song_id` VARCHAR(191) NOT NULL,
    `genre_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `genre_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_languages` (
    `song_id` VARCHAR(191) NOT NULL,
    `language_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `language_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_scenes` (
    `song_id` VARCHAR(191) NOT NULL,
    `scene_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `scene_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_moods` (
    `song_id` VARCHAR(191) NOT NULL,
    `mood_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `mood_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_decades` (
    `song_id` VARCHAR(191) NOT NULL,
    `decade_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `decade_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_tags` (
    `song_id` VARCHAR(191) NOT NULL,
    `tag_id` INTEGER NOT NULL,

    PRIMARY KEY (`song_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('super_admin', 'admin', 'editor', 'user') NOT NULL DEFAULT 'user',
    `status` ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login_at` DATETIME(3) NULL,
    `security_question` VARCHAR(200) NULL,
    `security_answer` VARCHAR(255) NULL,
    `reset_token` VARCHAR(255) NULL,
    `reset_token_expires_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operation_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `action` VARCHAR(50) NOT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` VARCHAR(50) NULL,
    `old_values` JSON NULL,
    `new_values` JSON NULL,
    `changed_fields` JSON NULL,
    `details` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `operation_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `operation_logs_user_id_idx`(`user_id`),
    INDEX `operation_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crawl_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_type` VARCHAR(50) NOT NULL,
    `platform` VARCHAR(20) NULL,
    `status` ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running',
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `success_count` INTEGER NOT NULL DEFAULT 0,
    `failed_count` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `genres` ADD CONSTRAINT `genres_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `genres`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tags` ADD CONSTRAINT `tags_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `tags`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_genres` ADD CONSTRAINT `song_genres_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_genres` ADD CONSTRAINT `song_genres_genre_id_fkey` FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_languages` ADD CONSTRAINT `song_languages_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_languages` ADD CONSTRAINT `song_languages_language_id_fkey` FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_scenes` ADD CONSTRAINT `song_scenes_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_scenes` ADD CONSTRAINT `song_scenes_scene_id_fkey` FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_moods` ADD CONSTRAINT `song_moods_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_moods` ADD CONSTRAINT `song_moods_mood_id_fkey` FOREIGN KEY (`mood_id`) REFERENCES `moods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_decades` ADD CONSTRAINT `song_decades_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_decades` ADD CONSTRAINT `song_decades_decade_id_fkey` FOREIGN KEY (`decade_id`) REFERENCES `decades`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_tags` ADD CONSTRAINT `song_tags_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_tags` ADD CONSTRAINT `song_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operation_logs` ADD CONSTRAINT `operation_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
