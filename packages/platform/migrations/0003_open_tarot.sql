CREATE TABLE `platform_delegation` (
	`account` text NOT NULL,
	`area` text NOT NULL,
	`level` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`account`, `area`, `level`),
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "platform_delegation_level" CHECK("platform_delegation"."level" IN ('read', 'write', 'manage')),
	CONSTRAINT "platform_delegation_value" CHECK("platform_delegation"."value" IN ('no', 'yes', 'confirm'))
);
