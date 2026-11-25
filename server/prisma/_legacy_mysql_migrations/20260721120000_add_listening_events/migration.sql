-- CreateTable
CREATE TABLE `listening_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `song_id` VARCHAR(191) NULL,
    `track_path` VARCHAR(500) NULL,
    `track_title` VARCHAR(300) NULL,
    `track_artist` VARCHAR(300) NULL,
    `event_type` VARCHAR(30) NOT NULL,
    `position_ms` INTEGER NULL,
    `duration_ms` INTEGER NULL,
    `feat_sub_bass` FLOAT NOT NULL DEFAULT 0,
    `feat_bass` FLOAT NOT NULL DEFAULT 0,
    `feat_low_mid` FLOAT NOT NULL DEFAULT 0,
    `feat_mid` FLOAT NOT NULL DEFAULT 0,
    `feat_high_mid` FLOAT NOT NULL DEFAULT 0,
    `feat_presence` FLOAT NOT NULL DEFAULT 0,
    `feat_brilliance` FLOAT NOT NULL DEFAULT 0,
    `feat_air` FLOAT NOT NULL DEFAULT 0,
    `feat_beat` FLOAT NOT NULL DEFAULT 0,
    `feat_beat_strength` FLOAT NOT NULL DEFAULT 0,
    `engagement_score` FLOAT NOT NULL DEFAULT 0,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `listening_events` ADD CONSTRAINT `listening_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX `listening_events_user_id_occurred_at_idx` ON `listening_events`(`user_id`, `occurred_at`);

-- CreateIndex
CREATE INDEX `listening_events_song_id_idx` ON `listening_events`(`song_id`);

-- CreateIndex
CREATE INDEX `listening_events_track_path_idx` ON `listening_events`(`track_path`);

-- CreateIndex
CREATE INDEX `listening_events_event_type_idx` ON `listening_events`(`event_type`);
